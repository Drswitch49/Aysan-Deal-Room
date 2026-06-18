import { airtableCreate, airtableUpdate, airtableFetch, airtableFetchRecord, TABLES, escapeFormulaString } from "./_utils/airtable.js";
import { authenticateAdmin } from "./admin/lenders_auth_helper.js";
import { ensureTable, TEAM_FIELD_SPECS } from "./_utils/schema-manager.js";
import bcrypt from "bcryptjs";

// Helper to generate a secure random password
function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%&*";
  let pass = "";
  for (let i = 0; i < 8; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

export default async function handler(req: any, res: any) {
  try {
    // 1. Authenticate user
    await authenticateAdmin(req);
    const roleLower = (req.user?.role || "").toLowerCase();

    // 2. Access Control: Write operations restricted to admins
    if (req.method !== "GET") {
      if (roleLower !== "admin" && roleLower !== "managing partner") {
        return res.status(403).json({ error: "Access denied: Insufficient permissions to manage team members." });
      }
    }

    if (req.method === "GET") {
      const { id } = req.query;
      if (id) {
        const record = await airtableFetchRecord(TABLES.TEAM, id);
        return res.status(200).json(record);
      }
      const data = await airtableFetch(TABLES.TEAM);
      return res.status(200).json(data.records || []);
    }

    if (req.method === "POST") {
      const { action, memberId, name, email, phone, role, status, accessLevel } = req.body || {};

      // --- Action 1: Reset Password ---
      if (action === "reset-password") {
        if (!memberId) {
          return res.status(400).json({ error: "Member ID is required for password reset" });
        }
        const member = await airtableFetchRecord(TABLES.TEAM, memberId);
        const memberEmail = member.fields["Email"];
        if (!memberEmail) {
          return res.status(400).json({ error: "Cannot reset password: user has no registered email" });
        }

        const tempPassword = generatePassword();
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(tempPassword, salt);

        const usersData = await airtableFetch("Users", {
          filterByFormula: `{Email} = '${escapeFormulaString(memberEmail)}'`,
          maxRecords: 1
        });

        if (usersData.records && usersData.records.length > 0) {
          await airtableUpdate("Users", usersData.records[0].id, { PasswordHash: hash });
        } else {
          // If User profile doesn't exist, create it
          await airtableCreate("Users", {
            Email: memberEmail.trim(),
            PasswordHash: hash,
            Role: (member.fields["Role"] || "Analyst").toLowerCase(),
            Status: member.fields["Status"] || "Active",
            Permissions: member.fields["Role"] === "Admin" || member.fields["Role"] === "Managing Partner" ? "admin" : "read",
            CreatedAt: new Date().toISOString()
          });
        }

        return res.status(200).json({ success: true, tempPassword });
      }

      // --- Action 2: Generate Login Link ---
      if (action === "generate-login-link") {
        if (!memberId) {
          return res.status(400).json({ error: "Member ID is required to generate login link" });
        }
        const origin = req.headers.origin || "http://localhost:5173";
        const loginLink = `${origin}/login`;
        await airtableUpdate(TABLES.TEAM, memberId, { "Login_Link": loginLink });
        return res.status(200).json({ success: true, loginLink });
      }

      // --- Standard Create Member ---
      if (!name || !email) {
        return res.status(400).json({ error: "Missing required fields: name, email" });
      }

      // Ensure schema is updated
      await ensureTable({ name: TABLES.TEAM, fields: TEAM_FIELD_SPECS }).catch(console.warn);

      const password = generatePassword();
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(password, salt);

      const origin = req.headers.origin || "http://localhost:5173";
      const loginLink = `${origin}/login`;

      const fields: Record<string, any> = {
        "Name": name,
        "Email": email,
        "Status": status || "Active",
        "Role": role || "Analyst",
        "Access_Level": accessLevel || (role === "Admin" || role === "Managing Partner" ? "FULL ACCESS" : "WRITE ACCESS"),
        "Initials": name.split(/\s+/).length >= 2
          ? (name.split(/\s+/)[0][0] + name.split(/\s+/)[name.split(/\s+/).length - 1][0]).toUpperCase()
          : name.substring(0, 2).toUpperCase(),
        "Avatar_Theme": role === "Admin" ? "purple" : role === "Managing Partner" ? "amber" : "blue",
        "Order": 99,
        "Login_Link": loginLink
      };
      if (phone) fields["Phone"] = phone;

      const record = await airtableCreate(TABLES.TEAM, fields);

      // Create User record in Users table
      await airtableCreate("Users", {
        Email: email.trim(),
        PasswordHash: hash,
        Role: (role || "Analyst").toLowerCase(),
        Status: status || "Active",
        Permissions: role === "Admin" || role === "Managing Partner" ? "admin" : "read",
        CreatedAt: new Date().toISOString()
      }).catch(err => console.warn("Failed to create user record for new team member:", err));

      return res.status(201).json({
        ...record,
        tempPassword: password,
        loginLink
      });
    }

    if (req.method === "PATCH") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Team member ID is required" });
      const body = req.body || {};

      const currentRecord = await airtableFetchRecord(TABLES.TEAM, id);
      const oldEmail = currentRecord.fields["Email"];

      const fields: Record<string, any> = {};
      if (body.name !== undefined) fields["Name"] = body.name;
      if (body.email !== undefined) fields["Email"] = body.email;
      if (body.phone !== undefined) fields["Phone"] = body.phone;
      if (body.role !== undefined) {
        fields["Role"] = body.role;
        fields["Access_Level"] = body.role === "Admin" || body.role === "Managing Partner" ? "FULL ACCESS" : "WRITE ACCESS";
        fields["Avatar_Theme"] = body.role === "Admin" ? "purple" : body.role === "Managing Partner" ? "amber" : "blue";
      }
      if (body.status !== undefined) fields["Status"] = body.status;
      if (body.loginLink !== undefined) fields["Login_Link"] = body.loginLink;

      const record = await airtableUpdate(TABLES.TEAM, id, fields);

      // Sync user profile updates to Users table
      if (oldEmail) {
        const usersData = await airtableFetch("Users", {
          filterByFormula: `{Email} = '${escapeFormulaString(oldEmail)}'`,
          maxRecords: 1
        });

        if (usersData.records && usersData.records.length > 0) {
          const userUpdate: Record<string, any> = {};
          if (body.email !== undefined) userUpdate["Email"] = body.email.trim();
          if (body.role !== undefined) {
            userUpdate["Role"] = body.role.toLowerCase();
            userUpdate["Permissions"] = body.role === "Admin" || body.role === "Managing Partner" ? "admin" : "read";
          }
          if (body.status !== undefined) userUpdate["Status"] = body.status;
          await airtableUpdate("Users", usersData.records[0].id, userUpdate);
        }
      }

      return res.status(200).json(record);
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Team member ID is required" });

      const member = await airtableFetchRecord(TABLES.TEAM, id);
      const email = member.fields["Email"];

      // Soft delete: update Status in ACP_Team to Inactive
      await airtableUpdate(TABLES.TEAM, id, { Status: "Inactive" });

      // Soft delete: update Status in Users to Inactive
      if (email) {
        const usersData = await airtableFetch("Users", {
          filterByFormula: `{Email} = '${escapeFormulaString(email)}'`,
          maxRecords: 1
        });
        if (usersData.records && usersData.records.length > 0) {
          await airtableUpdate("Users", usersData.records[0].id, { Status: "Inactive" });
        }
      }

      return res.status(200).json({ success: true, message: "Team member deactivated successfully (soft delete)." });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("[team-members-crud] Error:", error);
    return res.status(error.status || 500).json({ error: error.message || "Internal server error" });
  }
}

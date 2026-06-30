import { airtableCreate, airtableUpdate, airtableDelete, airtableFetch, airtableFetchRecord, TABLES, escapeFormulaString } from "./_utils/airtable.js";
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
    const isOwner = ["managing partner", "partner", "super admin", "owner"].includes(roleLower);

    // 2. Access Control: Write operations restricted to admins, owners, and HR
    if (req.method !== "GET") {
      const allowedWriteRoles = ["admin", "managing partner", "partner", "hr", "super admin", "owner"];
      if (!allowedWriteRoles.includes(roleLower)) {
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
      const targetId = memberId;
      const isSuperAdminRole = (r: string) => ["managing partner", "partner", "super admin", "owner"].includes((r || "").toLowerCase());

      // --- Action 1: Reset Password ---
      if (action === "reset-password") {
        if (!targetId) {
          return res.status(400).json({ error: "Member ID is required for password reset" });
        }
        const member = await airtableFetchRecord(TABLES.TEAM, targetId);
        const memberEmail = member.fields["Email"];
        const targetRole = member.fields["Role"] || "";
        
        if (isSuperAdminRole(targetRole) && !isOwner) {
          return res.status(403).json({ error: "Forbidden: Non-owners cannot reset passwords for Owner / Partner accounts." });
        }

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
            Name: member.fields["Name"] || "Team Member",
            Email: memberEmail.trim(),
            PasswordHash: hash,
            Role: (member.fields["Role"] || "Analyst").toLowerCase(),
            Status: member.fields["Status"] || "Active",
            Permissions: isSuperAdminRole(member.fields["Role"]) || member.fields["Role"] === "Admin" ? "admin" : "read",
            CreatedAt: new Date().toISOString()
          });
        }

        return res.status(200).json({ success: true, tempPassword });
      }

      // --- Action 2: Generate Login Link ---
      if (action === "generate-login-link") {
        if (!targetId) {
          return res.status(400).json({ error: "Member ID is required to generate login link" });
        }
        const member = await airtableFetchRecord(TABLES.TEAM, targetId);
        const targetRole = member.fields["Role"] || "";
        if (isSuperAdminRole(targetRole) && !isOwner) {
          return res.status(403).json({ error: "Forbidden: Non-owners cannot generate login links for Owner / Partner accounts." });
        }

        const origin = req.headers.origin || "http://localhost:5173";
        const loginLink = `${origin}/login`;
        await airtableUpdate(TABLES.TEAM, targetId, { "Login_Link": loginLink });
        return res.status(200).json({ success: true, loginLink });
      }

      // --- Standard Create Member ---
      if (!name || !email) {
        return res.status(400).json({ error: "Missing required fields: name, email" });
      }

      if (isSuperAdminRole(role) && !isOwner) {
        return res.status(403).json({ error: "Forbidden: Non-owners cannot create accounts with Owner / Partner privileges." });
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
        "Access_Level": accessLevel || (isSuperAdminRole(role) || role === "Admin" ? "FULL ACCESS" : role === "Read Only" ? "READ ONLY" : "WRITE ACCESS"),
        "Initials": name.split(/\s+/).length >= 2
          ? (name.split(/\s+/)[0][0] + name.split(/\s+/)[name.split(/\s+/).length - 1][0]).toUpperCase()
          : name.substring(0, 2).toUpperCase(),
        "Avatar_Theme": role === "Admin" ? "purple" : isSuperAdminRole(role) ? "amber" : "blue",
        "Order": 99,
        "Login_Link": loginLink
      };
      if (phone) fields["Phone"] = phone;

      const record = await airtableCreate(TABLES.TEAM, fields);

      // Create User record in Users table
      await airtableCreate("Users", {
        Name: name,
        Email: email.trim(),
        PasswordHash: hash,
        Role: (role || "Analyst").toLowerCase(),
        Status: status || "Active",
        Permissions: isSuperAdminRole(role) || role === "Admin" ? "admin" : role === "Read Only" ? "read" : "write",
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
      const isSuperAdminRole = (r: string) => ["managing partner", "partner", "super admin", "owner"].includes((r || "").toLowerCase());

      const currentRecord = await airtableFetchRecord(TABLES.TEAM, id);
      const targetRole = currentRecord.fields["Role"] || "";

      if (isSuperAdminRole(targetRole) && !isOwner) {
        return res.status(403).json({ error: "Forbidden: Non-owners cannot modify Owner / Partner accounts." });
      }

      if (body.role !== undefined && isSuperAdminRole(body.role) && !isOwner) {
        return res.status(403).json({ error: "Forbidden: Non-owners cannot assign Owner / Partner roles." });
      }

      const oldEmail = currentRecord.fields["Email"];

      const fields: Record<string, any> = {};
      if (body.name !== undefined) fields["Name"] = body.name;
      if (body.email !== undefined) fields["Email"] = body.email;
      if (body.phone !== undefined) fields["Phone"] = body.phone;
      if (body.role !== undefined) {
        fields["Role"] = body.role;
        fields["Access_Level"] = isSuperAdminRole(body.role) || body.role === "Admin" ? "FULL ACCESS" : body.role === "Read Only" ? "READ ONLY" : "WRITE ACCESS";
        fields["Avatar_Theme"] = body.role === "Admin" ? "purple" : isSuperAdminRole(body.role) ? "amber" : "blue";
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
          if (body.name !== undefined) userUpdate["Name"] = body.name;
          if (body.email !== undefined) userUpdate["Email"] = body.email.trim();
          if (body.role !== undefined) {
            userUpdate["Role"] = body.role.toLowerCase();
            userUpdate["Permissions"] = isSuperAdminRole(body.role) || body.role === "Admin" ? "admin" : body.role === "Read Only" ? "read" : "write";
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
      const isSuperAdminRole = (r: string) => ["managing partner", "partner", "super admin", "owner"].includes((r || "").toLowerCase());

      const member = await airtableFetchRecord(TABLES.TEAM, id);
      const targetRole = member.fields["Role"] || "";
      if (isSuperAdminRole(targetRole) && !isOwner) {
        return res.status(403).json({ error: "Forbidden: Non-owners cannot deactivate Owner / Partner accounts." });
      }

      const email = member.fields["Email"];

      if (req.user?.role === "super admin") {
        await airtableDelete(TABLES.TEAM, id);
        if (email) {
          const usersData = await airtableFetch("Users", {
            filterByFormula: `{Email} = '${escapeFormulaString(email)}'`,
            maxRecords: 1
          });
          if (usersData.records && usersData.records.length > 0) {
            await airtableDelete("Users", usersData.records[0].id);
          }
        }
        return res.status(200).json({ success: true, message: "Team member permanently deleted." });
      }

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

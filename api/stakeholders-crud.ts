import { airtableCreate, airtableUpdate, airtableFetch, airtableFetchRecord, TABLES, escapeFormulaString } from "./_utils/airtable.js";
import { authenticateAdmin } from "./admin/lenders_auth_helper.js";
import { ensureTable, STAKEHOLDER_FIELD_SPECS } from "./_utils/schema-manager.js";
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

    // 2. Access Control: Write operations restricted to admins, owners, and HR
    if (req.method !== "GET") {
      const allowedWriteRoles = ["admin", "managing partner", "partner", "hr", "super admin", "owner"];
      if (!allowedWriteRoles.includes(roleLower)) {
        return res.status(403).json({ error: "Access denied: Insufficient permissions to manage external stakeholders." });
      }
    }

    if (req.method === "GET") {
      const { id, type } = req.query;
      if (id) {
        const record = await airtableFetchRecord(TABLES.STAKEHOLDERS, id);
        return res.status(200).json(record);
      }
      const params: any = {};
      if (type) {
        params.filterByFormula = `{Type} = "${type}"`;
      }
      const data = await airtableFetch(TABLES.STAKEHOLDERS, params);
      return res.status(200).json(data.records || []);
    }

    if (req.method === "POST") {
      const { action, stakeholderId, name, type, email, phone, organization, notes, status, association, accentColor } = req.body || {};

      // --- Action 1: Reset Password ---
      if (action === "reset-password") {
        if (!stakeholderId) {
          return res.status(400).json({ error: "Stakeholder ID is required for password reset" });
        }
        const stakeholder = await airtableFetchRecord(TABLES.STAKEHOLDERS, stakeholderId);
        const stakeholderEmail = stakeholder.fields["Email"];
        if (!stakeholderEmail) {
          return res.status(400).json({ error: "Cannot reset password: stakeholder has no registered email" });
        }

        const tempPassword = generatePassword();
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(tempPassword, salt);

        const usersData = await airtableFetch("Users", {
          filterByFormula: `{Email} = '${escapeFormulaString(stakeholderEmail)}'`,
          maxRecords: 1
        });

        if (usersData.records && usersData.records.length > 0) {
          await airtableUpdate("Users", usersData.records[0].id, { PasswordHash: hash });
        } else {
          // Create User if not exists
          await airtableCreate("Users", {
            Name: stakeholder.fields["Name"] || "Stakeholder",
            Email: stakeholderEmail.trim(),
            PasswordHash: hash,
            Role: "stakeholder",
            Status: stakeholder.fields["Status"] || "Active",
            Permissions: "read",
            CreatedAt: new Date().toISOString()
          });
        }

        return res.status(200).json({ success: true, tempPassword });
      }

      // --- Action 2: Generate Login Link ---
      if (action === "generate-login-link") {
        if (!stakeholderId) {
          return res.status(400).json({ error: "Stakeholder ID is required to generate login link" });
        }
        const origin = req.headers.origin || "http://localhost:5173";
        const loginLink = `${origin}/login`;
        await airtableUpdate(TABLES.STAKEHOLDERS, stakeholderId, { "Login_Link": loginLink });
        return res.status(200).json({ success: true, loginLink });
      }

      // --- Standard Create Stakeholder ---
      if (!name || !type) {
        return res.status(400).json({ error: "Missing required fields: name, type" });
      }

      // Ensure schema is updated
      await ensureTable({ name: TABLES.STAKEHOLDERS, fields: STAKEHOLDER_FIELD_SPECS }).catch(console.warn);

      const password = generatePassword();
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(password, salt);

      const origin = req.headers.origin || "http://localhost:5173";
      const loginLink = `${origin}/login`;

      const fields: Record<string, any> = {
        "Name": name,
        "Type": type,
        "Association": association || organization || type || "External Partner",
        "Description": notes || "",
        "Accent_Color": accentColor || (type === "Broker" ? "amber" : type === "Lawyer" ? "blue" : "green"),
        "Status": status || "Active",
        "Login_Link": loginLink
      };
      if (email) fields["Email"] = email;
      if (phone) fields["Phone"] = phone;
      if (organization) fields["Company"] = organization;

      const record = await airtableCreate(TABLES.STAKEHOLDERS, fields);

      // Create corresponding user in Users table if email is provided
      if (email && email.trim()) {
        await airtableCreate("Users", {
          Name: name,
          Email: email.trim(),
          PasswordHash: hash,
          Role: (type || "stakeholder").toLowerCase(),
          Status: status || "Active",
          Permissions: "read",
          CreatedAt: new Date().toISOString()
        }).catch(err => console.warn("Failed to create user record for stakeholder:", err));
      }

      return res.status(201).json({
        ...record,
        tempPassword: password,
        loginLink
      });
    }

    if (req.method === "PATCH") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Stakeholder ID is required" });
      const body = req.body || {};

      const currentRecord = await airtableFetchRecord(TABLES.STAKEHOLDERS, id);
      const oldEmail = currentRecord.fields["Email"];

      const fields: Record<string, any> = {};
      if (body.name !== undefined) fields["Name"] = body.name;
      if (body.type !== undefined) {
        fields["Type"] = body.type;
        fields["Accent_Color"] = body.type === "Broker" ? "amber" : body.type === "Lawyer" ? "blue" : "green";
      }
      if (body.email !== undefined) fields["Email"] = body.email;
      if (body.phone !== undefined) fields["Phone"] = body.phone;
      if (body.organization !== undefined) {
        fields["Company"] = body.organization;
        fields["Association"] = body.organization;
      }
      if (body.notes !== undefined) fields["Description"] = body.notes;
      if (body.status !== undefined) fields["Status"] = body.status;
      if (body.loginLink !== undefined) fields["Login_Link"] = body.loginLink;

      const record = await airtableUpdate(TABLES.STAKEHOLDERS, id, fields);

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
          if (body.type !== undefined) userUpdate["Role"] = body.type.toLowerCase();
          if (body.status !== undefined) userUpdate["Status"] = body.status;
          await airtableUpdate("Users", usersData.records[0].id, userUpdate);
        }
      }

      return res.status(200).json(record);
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Stakeholder ID is required" });

      const stakeholder = await airtableFetchRecord(TABLES.STAKEHOLDERS, id);
      const email = stakeholder.fields["Email"];

      // Soft delete: update Status in External_Stakeholders to Inactive
      await airtableUpdate(TABLES.STAKEHOLDERS, id, { Status: "Inactive" });

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

      return res.status(200).json({ success: true, message: "Stakeholder deactivated successfully (soft delete)." });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("[stakeholders-crud] Error:", error);
    return res.status(error.status || 500).json({ error: error.message || "Internal server error" });
  }
}

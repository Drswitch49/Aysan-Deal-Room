import { airtableCreate, airtableUpdate, airtableDelete, airtableFetch, TABLES, escapeFormulaString } from "./_utils/airtable.js";
import { authenticateAdmin } from "./admin/lenders_auth_helper.js";
import bcrypt from "bcryptjs";

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
    await authenticateAdmin(req);
    const roleLower = (req.user?.role || "").toLowerCase();
    
    if (req.method !== "GET") {
      const allowedWriteRoles = ["admin", "managing partner", "partner", "hr", "super admin", "owner"];
      if (!allowedWriteRoles.includes(roleLower)) {
        return res.status(403).json({ error: "Insufficient permissions to manage shareholders" });
      }
    }

    if (req.method === "POST") {
      const { action } = req.body;

      if (action === "assign") {
        const { shareholderId, dealRef } = req.body;
        if (!shareholderId || !dealRef) return res.status(400).json({ error: "shareholderId and dealRef required" });

        // Check if assignment exists
        const filterByFormula = `AND({Shareholder_ID} = '${escapeFormulaString(shareholderId)}', {Deal_Ref} = '${escapeFormulaString(dealRef)}')`;
        const existing = await airtableFetch(TABLES.SHAREHOLDER_DEAL_ASSIGNMENTS, { filterByFormula });
        if (existing.records && existing.records.length > 0) {
          return res.status(400).json({ error: "Deal is already assigned to this shareholder." });
        }

        const asgRes = await airtableCreate(TABLES.SHAREHOLDER_DEAL_ASSIGNMENTS, {
          "Shareholder_ID": shareholderId,
          "Deal_Ref": dealRef
        });
        return res.status(200).json({ success: true, assignment: asgRes });
      }

      if (action === "remove-assignment") {
        const { assignmentId } = req.body;
        if (!assignmentId) return res.status(400).json({ error: "assignmentId required" });
        await airtableDelete(TABLES.SHAREHOLDER_DEAL_ASSIGNMENTS, assignmentId);
        return res.status(200).json({ success: true });
      }

      if (action === "reset-password") {
        const { shareholderId } = req.body;
        const tempPassword = generatePassword();
        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        
        const shRes = await airtableFetch(TABLES.SHAREHOLDERS, { filterByFormula: `RECORD_ID() = '${escapeFormulaString(shareholderId)}'` });
        const sh = shRes.records[0];
        if (!sh) return res.status(404).json({ error: "Shareholder not found" });

        const email = (sh.fields["Email"] || "").trim().toLowerCase();
        if (!email) return res.status(400).json({ error: "Shareholder has no email" });

        const usersRes = await airtableFetch("Users", { filterByFormula: `{Email} = '${escapeFormulaString(email)}'` });
        
        let loginLink = sh.fields["Login_Link"] || "";
        if (!loginLink) {
          loginLink = `https://${req.headers.host || "localhost:3000"}/shareholders/portal`;
          await airtableUpdate(TABLES.SHAREHOLDERS, shareholderId, { "Login_Link": loginLink });
        }

        if (usersRes.records && usersRes.records.length > 0) {
          await airtableUpdate("Users", usersRes.records[0].id, {
            "PasswordHash": hashedPassword
          });
        } else {
          await airtableCreate("Users", {
            "Email": email,
            "PasswordHash": hashedPassword,
            "Role": "Shareholder",
            "Name": sh.fields["Name"] || email,
            "Status": "Active"
          });
        }

        return res.status(200).json({ success: true, tempPassword, loginLink });
      }

      if (action === "generate-login-link") {
        const { shareholderId } = req.body;
        const loginLink = `https://${req.headers.host || "localhost:3000"}/shareholders/portal`;
        await airtableUpdate(TABLES.SHAREHOLDERS, shareholderId, { "Login_Link": loginLink });
        return res.status(200).json({ success: true, loginLink });
      }

      // Add shareholder
      const { name, email, phone, status, notes } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });

      const emailVal = email ? email.trim() : null;
      let tempPassword = null;

      if (emailVal) {
        const usersRes = await airtableFetch("Users", { filterByFormula: `{Email} = '${escapeFormulaString(emailVal)}'` });
        if (usersRes.records && usersRes.records.length === 0) {
          tempPassword = generatePassword();
          const hashedPassword = await bcrypt.hash(tempPassword, 10);
          await airtableCreate("Users", {
            "Email": emailVal,
            "PasswordHash": hashedPassword,
            "Role": "Shareholder",
            "Name": name,
            "Status": "Active"
          });
        }
      }

      const loginLink = `https://${req.headers.host || "localhost:3000"}/shareholders/portal`;
      const rec = await airtableCreate(TABLES.SHAREHOLDERS, {
        "Name": name,
        "Email": emailVal || undefined,
        "Phone": phone || undefined,
        "Status": status || "Active",
        "Notes": notes || undefined,
        "Login_Link": loginLink
      });

      return res.status(201).json({ success: true, id: rec.id, tempPassword, loginLink });
    }

    if (req.method === "PUT") {
      const { id, name, email, phone, status, notes } = req.body;
      if (!id) return res.status(400).json({ error: "id is required" });

      await airtableUpdate(TABLES.SHAREHOLDERS, id, {
        "Name": name,
        "Email": email || undefined,
        "Phone": phone || undefined,
        "Status": status,
        "Notes": notes || undefined
      });

      if (email) {
        const usersRes = await airtableFetch("Users", { filterByFormula: `{Email} = '${escapeFormulaString(email.trim())}'` });
        if (usersRes.records && usersRes.records.length > 0) {
          await airtableUpdate("Users", usersRes.records[0].id, {
            "Name": name,
            "Status": status
          });
        }
      }

      return res.status(200).json({ success: true });
    }

    if (req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "id is required" });

      // First delete all assignments
      const filterByFormula = `{Shareholder_ID} = '${escapeFormulaString(id)}'`;
      const assignments = await airtableFetch(TABLES.SHAREHOLDER_DEAL_ASSIGNMENTS, { filterByFormula });
      if (assignments.records && assignments.records.length > 0) {
        for (const a of assignments.records) {
          await airtableDelete(TABLES.SHAREHOLDER_DEAL_ASSIGNMENTS, a.id);
        }
      }

      // Find shareholder email
      const shRes = await airtableFetch(TABLES.SHAREHOLDERS, { filterByFormula: `RECORD_ID() = '${escapeFormulaString(id)}'` });
      if (shRes.records && shRes.records.length > 0) {
        const email = shRes.records[0].fields["Email"];
        if (email) {
          const usersRes = await airtableFetch("Users", { filterByFormula: `{Email} = '${escapeFormulaString(String(email).trim())}'` });
          if (usersRes.records && usersRes.records.length > 0) {
            await airtableDelete("Users", usersRes.records[0].id);
          }
        }
      }

      await airtableDelete(TABLES.SHAREHOLDERS, id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("[Shareholders API Error]", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}

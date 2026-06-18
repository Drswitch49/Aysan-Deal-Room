/**
 * API endpoint for Portfolio Company CRUD operations
 * POST /api/portfolio-companies-crud - Create company
 * GET /api/portfolio-companies-crud - List all companies
 * PATCH /api/portfolio-companies-crud?id=X - Update company
 */
import { airtableCreate, airtableUpdate, airtableFetch, airtableFetchRecord } from "./_utils/airtable.js";
import { authenticateAdmin } from "./admin/lenders_auth_helper.js";

const TABLE = "Portfolio_Companies";

export default async function handler(req: any, res: any) {
  try {
    // Enforce Admin Authentication
    await authenticateAdmin(req);

    if (req.method === "GET") {
      const { id, status } = req.query;
      if (id) {
        const record = await airtableFetchRecord(TABLE, id);
        return res.status(200).json(record);
      }
      const params: any = {};
      if (status === "Active") {
        params.filterByFormula = `{Status} = "Active"`;
      }
      const data = await airtableFetch(TABLE, params);
      return res.status(200).json(data.records || []);
    }

    if (req.method === "POST") {
      const {
        companyName, industry, location, status, revenue, ebitda, debt, headcount, notes,
        cash, currentRatio, dscr, operationalKpis, documentActivity
      } = req.body;
      if (!companyName || !industry || !location) {
        return res.status(400).json({ error: "Missing required fields: companyName, industry, location" });
      }
      const fields: Record<string, any> = {
        "Company_Name": companyName,
        "Industry": industry,
        "Location": location,
        "Status": status || "Active",
      };
      if (revenue) fields["Revenue"] = Number(revenue);
      if (ebitda) fields["EBITDA"] = Number(ebitda);
      if (debt) fields["Debt"] = Number(debt);
      if (headcount) fields["Headcount"] = Number(headcount);
      if (notes) fields["Notes"] = notes;
      if (cash) fields["Cash"] = Number(cash);
      if (currentRatio) fields["Current_Ratio"] = Number(currentRatio);
      if (dscr) fields["DSCR"] = Number(dscr);
      if (operationalKpis) fields["Operational_KPI_Inputs"] = operationalKpis;
      if (documentActivity) fields["Document_Activity_Inputs"] = documentActivity;

      const record = await airtableCreate(TABLE, fields);
      return res.status(201).json(record);
    }

    if (req.method === "PATCH") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Company ID is required" });
      const fields: Record<string, any> = {};
      const body = req.body;
      if (body.companyName) fields["Company_Name"] = body.companyName;
      if (body.industry) fields["Industry"] = body.industry;
      if (body.location) fields["Location"] = body.location;
      if (body.status) fields["Status"] = body.status;
      if (body.revenue !== undefined) fields["Revenue"] = Number(body.revenue);
      if (body.ebitda !== undefined) fields["EBITDA"] = Number(body.ebitda);
      if (body.debt !== undefined) fields["Debt"] = Number(body.debt);
      if (body.headcount !== undefined) fields["Headcount"] = Number(body.headcount);
      if (body.notes !== undefined) fields["Notes"] = body.notes;
      if (body.cash !== undefined) fields["Cash"] = Number(body.cash);
      if (body.currentRatio !== undefined) fields["Current_Ratio"] = Number(body.currentRatio);
      if (body.dscr !== undefined) fields["DSCR"] = Number(body.dscr);
      if (body.operationalKpis !== undefined) fields["Operational_KPI_Inputs"] = body.operationalKpis;
      if (body.documentActivity !== undefined) fields["Document_Activity_Inputs"] = body.documentActivity;

      const record = await airtableUpdate(TABLE, id, fields);
      return res.status(200).json(record);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("[portfolio-companies-crud] Error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}

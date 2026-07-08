import { airtableFetch, TABLES, escapeFormulaString } from "./_utils/airtable.js";
import { authenticateAdmin as authenticate } from "./admin/lenders_auth_helper.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    await authenticate(req);
    const user = req.user;
    
    // Allow admins/HR to view as well, but primarily for Shareholders
    if (!["shareholder", "admin", "super admin", "managing partner", "hr"].includes((user.role || "").toLowerCase())) {
      return res.status(403).json({ error: "Access denied. Shareholder access required." });
    }

    const email = user.email.toLowerCase().trim();

    // Find the Shareholder record by email
    const shRes = await airtableFetch(TABLES.SHAREHOLDERS, { filterByFormula: `{Email} = '${escapeFormulaString(email)}'` });
    if (!shRes.records || shRes.records.length === 0) {
      if ((user.role || "").toLowerCase() === "shareholder") {
        return res.status(404).json({ error: "Shareholder profile not found." });
      } else {
        // Admin viewing but not linked to a shareholder profile
        return res.status(200).json({ deals: [] });
      }
    }

    const shareholderId = shRes.records[0].id;

    // Fetch assignments for this shareholder
    const asgRes = await airtableFetch(TABLES.SHAREHOLDER_DEAL_ASSIGNMENTS, { filterByFormula: `{Shareholder_ID} = '${escapeFormulaString(shareholderId)}'` });
    const assignments = asgRes.records || [];

    if (assignments.length === 0) {
      return res.status(200).json({ deals: [] });
    }

    const dealRefs = assignments.map((a: any) => a.fields["Deal_Ref"]).filter(Boolean);

    // Fetch deals
    const pipelineRes = await airtableFetch(TABLES.PIPELINE);
    const pipeline = pipelineRes.records || [];

    const deals = dealRefs.map((ref: string) => {
      const deal = pipeline.find((d: any) => d.fields["REF. NO"] === ref || d.fields["Deal_Ref"] === ref);
      if (!deal) return null;

      const imDocs = Array.isArray(deal.fields["IM_Review_Documents"]) ? deal.fields["IM_Review_Documents"].map((d: any) => ({
        id: d.id,
        name: d.filename,
        type: d.type || "application/pdf",
        url: d.url,
        uploadedAt: deal.createdTime,
      })) : [];

      const attachDocs = Array.isArray(deal.fields["Attachments"]) ? deal.fields["Attachments"].map((d: any) => ({
        id: d.id,
        name: d.filename,
        type: d.type || "application/pdf",
        url: d.url,
        uploadedAt: deal.createdTime,
      })) : [];

      const dealDocs = [...imDocs, ...attachDocs];

      // STRICTLY omit internal info
      return {
        id: deal.id,
        dealRef: ref,
        companyName: deal.fields["Company_Name"] || deal.fields["Company Name"] || "Unknown",
        industry: deal.fields["Industry"] || "N/A",
        executiveSummary: deal.fields["Executive_Summary"] || deal.fields["Summary"] || "",
        businessDescription: deal.fields["Business_Description"] || "",
        ebitda: deal.fields["EBITDA"] || 0,
        revenue: deal.fields["Revenue"] || 0,
        askingPrice: deal.fields["Asking_Price"] || 0,
        enterpriseValue: deal.fields["Enterprise_Value"] || 0,
        stage: deal.fields["Stage"] || "N/A",
        location: deal.fields["Location"] || "",
        documents: dealDocs
      };
    }).filter(Boolean);

    return res.status(200).json({ deals });
  } catch (err: any) {
    console.error("[Shareholder Portal Error]", err);
    return res.status(err.status || 500).json({ error: err.message || "Internal server error" });
  }
}

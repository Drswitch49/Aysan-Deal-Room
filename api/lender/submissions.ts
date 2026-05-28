import { airtableFetch, TABLES, escapeFormulaString } from "../_utils/airtable";
import { authenticateLender } from "./deals";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate lender
    const lender = await authenticateLender(req);
    const lenderRecordId = lender.id;
    const lenderIdText = lender.fields.Lender_ID;
    const companyName = lender.fields.Company_Name || "";

    // 2. Fetch lender assignments
    const assignmentsData = await airtableFetch(TABLES.ASSIGNMENTS, {
      filterByFormula: `AND(OR({Lender_ID} = '${lenderRecordId}', {Lender_ID} = '${escapeFormulaString(lenderIdText)}'), {Status} = 'Active')`
    });

    if (!assignmentsData.records || assignmentsData.records.length === 0) {
      return res.status(200).json([]);
    }

    // Resolve assigned deal IDs and deal references
    const dealIds = new Set<string>();
    const dealRefs = new Set<string>();

    for (const record of assignmentsData.records) {
      const dealRefVal = record.fields.Deal_Ref;
      if (dealRefVal) {
        if (Array.isArray(dealRefVal)) {
          dealRefVal.forEach(id => dealIds.add(id));
        } else {
          dealRefs.add(String(dealRefVal));
        }
      }
    }

    // Query active pipeline to match deal IDs to Deal_Ref values (e.g. "KBS 159237")
    const pipelineData = await airtableFetch(TABLES.PIPELINE);
    pipelineData.records.forEach((record: any) => {
      if (dealIds.has(record.id)) {
        const refNo = record.fields["REF No."] || record.fields.Deal_Ref || record.fields.dealRef || record.fields["Deal Name"];
        if (refNo) dealRefs.add(String(refNo));
      }
    });

    // 3. Fetch submission logs
    const submissionsData = await airtableFetch(TABLES.SUBMISSIONS);

    // 4. Filter logs:
    // - Must belong to one of the assigned deals (matching by Deal_Ref)
    // - Sent_To must be blank or match this lender's company name (so they don't see other lenders)
    const logs = submissionsData.records.filter((entry: any) => {
      const entryDealRefs = entry.fields.Deal_Ref || [];
      const belongsToAssignedDeal = Array.isArray(entryDealRefs)
        ? entryDealRefs.some(id => dealIds.has(id))
        : dealIds.has(String(entryDealRefs));
      
      const sentToVal = String(entry.fields.Sent_To || "").trim();
      const isLenderSpecific = !sentToVal || sentToVal.toLowerCase() === companyName.toLowerCase();

      return belongsToAssignedDeal && isLenderSpecific;
    });

    const mappedLogs = logs.map((entry: any) => {
      return {
        id: entry.id,
        dealRef: Array.isArray(entry.fields.Deal_Ref) ? entry.fields.Deal_Ref[0] : (entry.fields.Deal_Ref || ""),
        date: entry.fields.Date || entry.createdTime || "",
        whatWasSent: entry.fields.What_Was_Sent || "",
        sentTo: entry.fields.Sent_To || "",
        sentVia: entry.fields.Sent_Via || "",
        responseReceived: entry.fields.Response_Received || "",
        flag: entry.fields.Flag || ""
      };
    });

    return res.status(200).json(mappedLogs);
  } catch (err: any) {
    return res.status(err.status || 401).json({ error: err.message, type: err.type });
  }
}

import {
  airtableFetch,
  airtableCreate,
  TABLES,
  escapeFormulaString,
  getAssignmentFields,
  normalizeLenderFields
} from "../_utils/airtable.js";
import { authenticateLender } from "./deals.js";

export default async function handler(req: any, res: any) {
  // Allow GET and POST methods
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Lender
    const lender = await authenticateLender(req);
    const lenderRecordId = lender.id;
    const lenderIdText = lender.normalizedFields.Lender_ID;
    const companyName = lender.normalizedFields.Company_Name || "Lender";

    // 2. Resolve parameters based on method
    let dealId = "";
    let message = "";

    if (req.method === "GET") {
      dealId = req.query.dealId || "";
    } else {
      const body = req.body || {};
      dealId = body.dealId || "";
      message = body.message || "";
    }

    if (req.method === "POST" && !dealId) {
      return res.status(400).json({ error: "Deal ID is required" });
    }

    if (req.method === "POST" && (!message || message.trim() === "")) {
      return res.status(400).json({ error: "Message content cannot be empty" });
    }

    // If GET and no dealId is provided, fetch ALL recent chat messages for this lender
    if (req.method === "GET" && !dealId) {
      const lenderName = lender.fields.Name || companyName;
      const formula = `{Lender_ID} = '${escapeFormulaString(lenderName)}'`;
      
      const chatData = await airtableFetch(TABLES.CHAT, {
        filterByFormula: formula
      });

      const messages = chatData.records.map((rec: any) => {
        return {
          id: rec.id,
          dealId: Array.isArray(rec.fields.Deal_Ref) ? rec.fields.Deal_Ref[0] : (rec.fields.Deal_Ref || ""),
          lenderId: Array.isArray(rec.fields.Lender_ID) ? rec.fields.Lender_ID[0] : (rec.fields.Lender_ID || ""),
          sender: rec.fields.Sender || "",
          message: rec.fields.Message || "",
          timestamp: rec.fields.Timestamp || rec.createdTime || ""
        };
      }).sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return res.status(200).json(messages);
    }

    // 3. Verify that the lender is assigned to this deal (for security)
    const { lenderIdCol, lenderIdLookupCol, statusCol } = await getAssignmentFields();
    let filterFormula = `OR({${lenderIdCol}} = '${lenderRecordId}', {${lenderIdCol}} = '${escapeFormulaString(lenderIdText)}')`;
    if (lenderIdLookupCol) {
      filterFormula = `OR(${filterFormula}, {${lenderIdLookupCol}} = '${escapeFormulaString(lenderIdText)}')`;
    }
    if (statusCol) {
      filterFormula = `AND(${filterFormula}, {${statusCol}} = 'Active')`;
    }

    const assignmentsData = await airtableFetch(TABLES.ASSIGNMENTS, {
      filterByFormula: filterFormula
    });

    if (!assignmentsData.records || assignmentsData.records.length === 0) {
      return res.status(403).json({ error: "Access denied. No active assignments found for this lender." });
    }

    // Resolve assigned deal record IDs
    const dealIds = new Set<string>();
    const dealRefs = new Set<string>();

    for (const record of assignmentsData.records) {
      const dealRefVal = record.fields.Deal_Ref;
      if (dealRefVal) {
        if (Array.isArray(dealRefVal)) {
          dealRefVal.forEach(id => dealIds.add(id));
        } else {
          dealRefs.add(String(dealRefVal).toLowerCase());
        }
      }
    }

    // Query active pipeline to check if the provided dealId matches by record ID or by text reference
    const pipelineData = await airtableFetch(TABLES.PIPELINE);
    
    // Find the record ID of the deal (whether they passed the record ID or text ref)
    const activeDeal = pipelineData.records.find((rec: any) => {
      const refNo = rec.fields["REF No."] || rec.fields.Deal_Ref || rec.fields.dealRef || rec.fields["Deal Name"];
      return rec.id === dealId || String(refNo).toLowerCase() === dealId.toLowerCase();
    });

    if (!activeDeal) {
      return res.status(404).json({ error: "Acquisition deal not found in active pipeline." });
    }

    const resolvedDealId = activeDeal.id;

    // Verify if this deal is assigned to the current lender
    const refNo = activeDeal.fields["REF No."] || activeDeal.fields.Deal_Ref || activeDeal.fields.dealRef || activeDeal.fields["Deal Name"];
    const isAssigned = dealIds.has(resolvedDealId) || (refNo && dealRefs.has(String(refNo).toLowerCase()));
    if (!isAssigned) {
      return res.status(403).json({ error: "Access denied. You are not assigned to this deal's chat." });
    }

    // 4. Handle GET (Fetch Messages)
    if (req.method === "GET") {
      const lenderName = lender.fields.Name || companyName;
      const dealName = activeDeal.fields["Deal Name"] || "";
      const formula = `AND({Lender_ID} = '${escapeFormulaString(lenderName)}', {Deal_Ref} = '${escapeFormulaString(dealName)}')`;
      
      const chatData = await airtableFetch(TABLES.CHAT, {
        filterByFormula: formula
      });

      const messages = chatData.records.map((rec: any) => {
        return {
          id: rec.id,
          dealId: Array.isArray(rec.fields.Deal_Ref) ? rec.fields.Deal_Ref[0] : (rec.fields.Deal_Ref || ""),
          lenderId: Array.isArray(rec.fields.Lender_ID) ? rec.fields.Lender_ID[0] : (rec.fields.Lender_ID || ""),
          sender: rec.fields.Sender || "",
          message: rec.fields.Message || "",
          timestamp: rec.fields.Timestamp || rec.createdTime || ""
        };
      }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      return res.status(200).json(messages);
    }

    // 5. Handle POST (Send Message)
    if (req.method === "POST") {
      const newFields = {
        Lender_ID: [lenderRecordId],
        Deal_Ref: [resolvedDealId],
        Sender: companyName,
        Message: message,
        Timestamp: new Date().toISOString()
      };

      const createdRecord = await airtableCreate(TABLES.CHAT, newFields);
      
      const mappedMessage = {
        id: createdRecord.id,
        dealId: Array.isArray(createdRecord.fields.Deal_Ref) ? createdRecord.fields.Deal_Ref[0] : (createdRecord.fields.Deal_Ref || resolvedDealId),
        lenderId: Array.isArray(createdRecord.fields.Lender_ID) ? createdRecord.fields.Lender_ID[0] : (createdRecord.fields.Lender_ID || lenderRecordId),
        sender: createdRecord.fields.Sender || companyName,
        message: createdRecord.fields.Message || message,
        timestamp: createdRecord.fields.Timestamp || createdRecord.createdTime || new Date().toISOString()
      };

      return res.status(200).json(mappedMessage);
    }

  } catch (err: any) {
    // If the Chat_Messages table doesn't exist, handle it gracefully
    if (err.status === 404 || err.type === "TABLE_NOT_FOUND") {
      return res.status(404).json({
        error: "Chat table not setup",
        type: "TABLE_NOT_FOUND",
        message: "The 'Chat_Messages' table was not found in Airtable. Please create this table to enable chat."
      });
    }
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}

import { airtableFetch, airtableFetchRecord, TABLES, escapeFormulaString } from "../_utils/airtable.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  const { portalSlug, password } = req.body || {};
  if (!portalSlug || !password) {
    return res.status(400).json({ error: "Portal slug and password are required" });
  }

  try {
    // 1. Fetch lender matching the slug
    const lendersData = await airtableFetch(TABLES.LENDERS, {
      filterByFormula: `{Portal_Slug} = '${escapeFormulaString(portalSlug)}'`,
      maxRecords: 1
    });

    if (!lendersData.records || lendersData.records.length === 0) {
      return res.status(401).json({ error: "Invalid portal URL or access expired." });
    }

    const lenderRecord = lendersData.records[0];
    const { fields, id: lenderRecordId } = lenderRecord;

    // 2. Validate password and status
    if (fields.Portal_Password !== password) {
      return res.status(401).json({ error: "Incorrect portal passcode." });
    }

    if (fields.Status !== "Active") {
      return res.status(403).json({ error: "Portal access has been deactivated." });
    }

    // 3. Fetch deal assignments for this lender
    const lenderIdText = fields.Lender_ID;
    const assignmentsData = await airtableFetch(TABLES.ASSIGNMENTS, {
      filterByFormula: `AND(OR({Lender_ID} = '${lenderRecordId}', {Lender_ID} = '${escapeFormulaString(lenderIdText)}'), {Status} = 'Active')`
    });

    // 4. Resolve Deal Reference values (e.g. "KBS 159237")
    const assignedDealRefs: string[] = [];
    if (assignmentsData.records && assignmentsData.records.length > 0) {
      for (const record of assignmentsData.records) {
        const dealRefVal = record.fields.Deal_Ref;
        if (dealRefVal) {
          if (Array.isArray(dealRefVal)) {
            // It's a linked record array, we will query them by ID or get lookup name
            // In Airtable, linked records return as arrays of record IDs, but wait:
            // Does the table have a lookup field returning the name/REF No. of the deal?
            // Usually, yes. But to be 100% sure, we can fetch the deal record by ID!
            // Let's resolve the deal record from Active_Pipeline
            for (const dId of dealRefVal) {
              try {
                const dealData = await airtableFetchRecord(TABLES.PIPELINE, dId);
                const refNo = dealData.fields["REF No."] || dealData.fields.Deal_Ref || dealData.fields.dealRef || dealData.fields["Deal Name"];
                if (refNo) assignedDealRefs.push(String(refNo));
              } catch {}
            }
          } else {
            // It's a string value, we can push it directly!
            assignedDealRefs.push(String(dealRefVal));
          }
        }
      }
    }

    // Remove password from profile response
    const profile = { ...fields };
    delete (profile as any).Portal_Password;

    return res.status(200).json({
      success: true,
      lender: {
        id: lenderRecordId,
        ...profile
      },
      assignedDeals: Array.from(new Set(assignedDealRefs))
    });
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}

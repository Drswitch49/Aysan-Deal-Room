import { airtableFetchAll, airtableFetchRecord } from "../src/lib/airtable/client.js";
import { TABLES } from "../src/lib/airtable/schema.js";
import { escapeFormulaString } from "../src/lib/airtable/queries.js";
import { normalizeLenderFields, getAssignmentFields } from "./_utils/airtable.js";
import { signJWT, setSessionCookie } from "./_utils/jwt.js";

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
    const lendersData = await airtableFetchAll(TABLES.LENDERS, {
      filterByFormula: `{Portal_Slug} = '${escapeFormulaString(portalSlug)}'`,
      maxRecords: 1
    });

    if (!lendersData.records || lendersData.records.length === 0) {
      return res.status(401).json({ error: "Invalid portal URL or access expired." });
    }

    const lenderRecord = lendersData.records[0];
    const lenderRecordId = lenderRecord.id;
    const fields = normalizeLenderFields(lenderRecord.fields);

    // 2. Validate password and status
    if (fields.Portal_Password !== password) {
      return res.status(401).json({ error: "Incorrect portal passcode." });
    }

    if (fields.Status !== "Active") {
      return res.status(403).json({ error: "Portal access has been deactivated." });
    }

    // 3. Fetch deal assignments for this lender
    const lenderIdText = fields.Lender_ID;
    const { lenderIdCol, lenderIdLookupCol, statusCol } = await getAssignmentFields();
    
    let filterFormula = `OR({${lenderIdCol}} = '${lenderRecordId}', {${lenderIdCol}} = '${escapeFormulaString(lenderIdText)}')`;
    if (lenderIdLookupCol) {
      filterFormula = `OR(${filterFormula}, {${lenderIdLookupCol}} = '${escapeFormulaString(lenderIdText)}')`;
    }
    if (statusCol) {
      filterFormula = `AND(${filterFormula}, {${statusCol}} = 'Active')`;
    }

    const assignmentsData = await airtableFetchAll(TABLES.ASSIGNMENTS, {
      filterByFormula: filterFormula
    });

    // 4. Resolve Deal Reference values (e.g. "KBS 159237")
    const assignedDealRefs: string[] = [];
    if (assignmentsData.records && assignmentsData.records.length > 0) {
      for (const record of assignmentsData.records) {
        const dealRefVal = record.fields.Deal_Ref;
        if (dealRefVal) {
          if (Array.isArray(dealRefVal)) {
            for (const dId of dealRefVal) {
              try {
                const dealData = await airtableFetchRecord(TABLES.PIPELINE, dId);
                const refNo = dealData.fields["REF No."] || dealData.fields.Deal_Ref || dealData.fields.dealRef || dealData.fields["Deal Name"];
                if (refNo) assignedDealRefs.push(String(refNo));
              } catch {}
            }
          } else {
            assignedDealRefs.push(String(dealRefVal));
          }
        }
      }
    }

    // 5. Generate secure JWT and set cookie
    const payload = {
      id: lenderRecordId,
      email: fields.Email || `${portalSlug}@lender-portal.com`,
      role: "lender",
      portalSlug: portalSlug,
      permissions: "read"
    };
    const token = await signJWT(payload);
    setSessionCookie(res, token);

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

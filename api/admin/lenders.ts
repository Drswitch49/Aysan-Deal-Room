import { airtableFetch, TABLES, normalizeLenderFields, normalizeAssignmentFields } from "../_utils/airtable.js";

// Helper to authenticate admin
export async function authenticateAdmin(req: any) {
  const adminPasscode = req.headers["x-admin-passcode"];
  const requiredPass = process.env.VITE_LENDER_ROOM_PASSWORD || "acp-deal-room";
  
  if (adminPasscode === requiredPass) {
    return;
  }

  try {
    const adminRecords = await airtableFetch(TABLES.LENDERS, {
      filterByFormula: `{Lender_ID} = 'admin'`,
      maxRecords: 1
    });
    if (adminRecords.records && adminRecords.records.length > 0) {
      const dbPassword = adminRecords.records[0].fields.Portal_Password;
      if (dbPassword && adminPasscode === dbPassword) {
        return;
      }
    }
  } catch (err) {
    console.error("Failed to check custom admin password in Airtable:", err);
  }

  throw new Error("Unauthorized admin request");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Validate admin auth
    await authenticateAdmin(req);

    // 2. Fetch Lenders, Assignments, and Deals in parallel
    const [lendersRes, assignmentsRes, pipelineRes] = await Promise.all([
      airtableFetch(TABLES.LENDERS).catch(() => ({ records: [] })),
      airtableFetch(TABLES.ASSIGNMENTS).catch(() => ({ records: [] })),
      airtableFetch(TABLES.PIPELINE).catch(() => ({ records: [] }))
    ]);

    // 3. Map Deal ID -> REF No. for linked record lookups
    const dealIdToRefMap = new Map<string, string>();
    pipelineRes.records.forEach((rec: any) => {
      const ref = rec.fields["REF No."] || rec.fields.Deal_Ref || rec.fields.dealRef || rec.fields["Deal Name"];
      if (ref) {
        dealIdToRefMap.set(rec.id, String(ref));
      }
    });

    // 4. Map Lender ID -> List of Assigned Deal Refs
    const lenderToDealsMap = new Map<string, Array<{ assignmentId: string; dealRef: string; assignedAt: string }>>();
    
    assignmentsRes.records.forEach((rec: any) => {
      const normFields = normalizeAssignmentFields(rec.fields);
      const lenderRefs = normFields.Lender_ID;
      const dealRefs = normFields.Deal_Ref;
      const assignedAt = normFields.Assigned_At || rec.createdTime;
      const status = normFields.Status || "Active";

      if (status !== "Active" || !lenderRefs || !dealRefs) return;

      // Extract lender identifiers
      const lenderIds = Array.isArray(lenderRefs) ? lenderRefs : [String(lenderRefs)];
      
      // Extract deal references
      const resolvedDealRefs: string[] = [];
      const dealIdentifiers = Array.isArray(dealRefs) ? dealRefs : [String(dealRefs)];
      dealIdentifiers.forEach(idOrText => {
        if (dealIdToRefMap.has(idOrText)) {
          resolvedDealRefs.push(dealIdToRefMap.get(idOrText)!);
        } else {
          resolvedDealRefs.push(idOrText); // Fallback to raw text if not a record ID
        }
      });

      lenderIds.forEach(lId => {
        resolvedDealRefs.forEach(dRef => {
          if (!lenderToDealsMap.has(lId)) {
            lenderToDealsMap.set(lId, []);
          }
          lenderToDealsMap.get(lId)!.push({
            assignmentId: rec.id,
            dealRef: dRef,
            assignedAt
          });
        });
      });
    });

    // 5. Build Lenders payload
    const lenders = lendersRes.records
      .filter((rec: any) => {
        const normFields = normalizeLenderFields(rec.fields);
        return normFields.Lender_ID !== "admin";
      })
      .map((rec: any) => {
        const normFields = normalizeLenderFields(rec.fields);
        const lenderIdText = normFields.Lender_ID || "";
        const isNdaApproved = normFields.NDA_Approved === "Yes" || normFields.NDA_Approved === "yes" || normFields.NDA_Approved === true;
        
        // Find assignments by record ID or by text ID
        const byRecordId = lenderToDealsMap.get(rec.id) || [];
        const byTextId = lenderIdText ? (lenderToDealsMap.get(lenderIdText) || []) : [];
        
        // Deduplicate deal assignments
        const seenDeals = new Set<string>();
        const assignments: Array<{ assignmentId: string; dealRef: string; assignedAt: string; ndaApproved: boolean }> = [];

        [...byRecordId, ...byTextId].forEach(asg => {
          if (!seenDeals.has(asg.dealRef)) {
            seenDeals.add(asg.dealRef);
            assignments.push({
              ...asg,
              ndaApproved: isNdaApproved
            });
          }
        });

        return {
          id: rec.id,
          ...normFields,
          ndaApproved: isNdaApproved,
          assignments
        };
      });

    return res.status(200).json(lenders);
  } catch (err: any) {
    return res.status(err.status || 500).json({ error: err.message, type: err.type });
  }
}

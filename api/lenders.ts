import { airtableFetchAll, getBaseSchema } from "../src/lib/airtable/client.js";
import { TABLES } from "../src/lib/airtable/schema.js";
import { authenticateAdmin } from "./admin/lenders.js";
import { normalizeLenderFields } from "./_utils/airtable.js";

// In-memory cache for lenders data
interface LenderCacheEntry {
  timestamp: number;
  data: any;
}

let lendersCache: LenderCacheEntry | null = null;
const CACHE_TTL_MS = 60000; // 60 seconds

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    // 1. Authenticate Admin BEFORE serving any data (even cached data)
    await authenticateAdmin(req);

    // 2. Serve from cache if valid
    if (lendersCache && Date.now() - lendersCache.timestamp < CACHE_TTL_MS) {
      return res.status(200).json(lendersCache.data);
    }

    // 3. Fetch Lenders, Assignments, and Pipeline in parallel
    const [lendersRes, assignmentsRes, pipelineRes] = await Promise.all([
      airtableFetchAll(TABLES.LENDERS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.ASSIGNMENTS).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.PIPELINE).catch(() => ({ records: [] }))
    ]);

    // 4. Map Deal ID -> REF No. for linked record lookups
    const dealIdToRefMap = new Map<string, string>();
    pipelineRes.records.forEach((rec: any) => {
      const ref = rec.fields["REF No."] || rec.fields.Deal_Ref || rec.fields.dealRef || rec.fields["Deal Name"];
      if (ref) {
        dealIdToRefMap.set(rec.id, String(ref));
      }
    });

    // 5. Map Lender ID -> List of Assigned Deal Refs
    const lenderToDealsMap = new Map<string, Array<{ assignmentId: string; dealRef: string; assignedAt: string }>>();
    
    assignmentsRes.records.forEach((rec: any) => {
      const lenderRefs = rec.fields.Lenders_ID || rec.fields.Lender_ID;
      const dealRefs = rec.fields.Deal_Ref;
      const assignedAt = rec.fields.Assigned_At || rec.createdTime;
      const status = rec.fields.Status || "Active";

      if (status !== "Active" || !lenderRefs || !dealRefs) return;

      const lenderIds = Array.isArray(lenderRefs) ? lenderRefs : [String(lenderRefs)];
      const resolvedDealRefs: string[] = [];
      const dealIdentifiers = Array.isArray(dealRefs) ? dealRefs : [String(dealRefs)];
      
      dealIdentifiers.forEach(idOrText => {
        if (dealIdToRefMap.has(idOrText)) {
          resolvedDealRefs.push(dealIdToRefMap.get(idOrText)!);
        } else {
          resolvedDealRefs.push(idOrText);
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

    // 6. Build Lenders payload
    const lenders = lendersRes.records
      .filter((rec: any) => {
        return rec.fields.Lender_ID !== "admin";
      })
      .map((rec: any) => {
        const lenderIdText = rec.fields.Lender_ID || "";
        const isNdaApproved = rec.fields.NDA_APPROVED === "Yes" || rec.fields.NDA_APPROVED === "yes" || rec.fields.NDA_APPROVED === true;
        
        const byRecordId = lenderToDealsMap.get(rec.id) || [];
        const byTextId = lenderIdText ? (lenderToDealsMap.get(lenderIdText) || []) : [];
        
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

        const normFields = normalizeLenderFields(rec.fields);
        return {
          id: rec.id,
          ...normFields,
          ndaApproved: isNdaApproved,
          assignments
        };
      });

    // 7. Update Cache
    lendersCache = {
      timestamp: Date.now(),
      data: lenders
    };

    return res.status(200).json(lenders);
  } catch (err: any) {
    console.error(`[API Lenders Error] Error: ${err.message || err}`);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

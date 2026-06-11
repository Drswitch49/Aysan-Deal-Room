import { airtableFetchAll } from "../src/lib/airtable/client.js";
import { TABLES } from "../src/lib/airtable/schema.js";
import { mapPipelineDeal, mapDocument, mapSubmissionLogEntry } from "../src/lib/airtable/mapper.js";
import { authenticateAdmin } from "./admin/lenders.js";

// In-memory cache variables for server warm starts
interface CacheEntry {
  timestamp: number;
  data: any;
}

const cache: Record<string, CacheEntry> = {};
const CACHE_TTL_MS = 60000; // 60 seconds

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  const { type, ref } = req.query || {};

  try {
    // 1. Admin authentication check for sensitive Deal Inbox access
    if (type === "inbox") {
      await authenticateAdmin(req);
    }

    // Determine target table and mapping logic
    let tableName = TABLES.PIPELINE;
    let mapper: (id: string, fields: any) => any = mapPipelineDeal;
    let cacheKey = "deals";

    if (type === "documents") {
      tableName = TABLES.DOCUMENTS;
      mapper = mapDocument;
      cacheKey = "documents";
    } else if (type === "submissions") {
      tableName = TABLES.SUBMISSIONS;
      mapper = mapSubmissionLogEntry;
      cacheKey = "submissions";
    } else if (type === "inbox") {
      tableName = TABLES.DEAL_INBOX;
      cacheKey = "inbox";
    }

    // 1.5. Resolve deal reference to record ID if ref is provided
    let targetDealId: string | null = null;
    if (ref) {
      let pipelineDeals: any[] = [];
      const cachedDeals = cache["deals"];
      if (cachedDeals && Date.now() - cachedDeals.timestamp < CACHE_TTL_MS) {
        pipelineDeals = cachedDeals.data;
      } else {
        const responseDeals = await airtableFetchAll(TABLES.PIPELINE);
        pipelineDeals = responseDeals.records.map((rec: any) => mapPipelineDeal(rec.id, rec.fields));
        cache["deals"] = {
          timestamp: Date.now(),
          data: pipelineDeals
        };
      }
      const matchedDeal = pipelineDeals.find((d: any) => (d.dealRef || "").toLowerCase() === String(ref).toLowerCase());
      if (matchedDeal) {
        targetDealId = matchedDeal.id;
      }
    }

    // 2. Serve from in-memory cache if valid
    const cached = cache[cacheKey];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      // If client requested a specific deal reference, filter on the fly
      if (ref) {
        const filtered = filterResults(cached.data, type, ref, targetDealId);
        return res.status(200).json(filtered);
      }
      
      // Apply Edge CDN headers for read-heavy operations (except admin inbox)
      if (type !== "inbox") {
        res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=30");
      }
      return res.status(200).json(cached.data);
    }

    // 3. Fetch from Airtable client
    const response = await airtableFetchAll(tableName);
    let results: any[];

    if (type === "inbox") {
      // Inbox keeps raw fields but returns mapped record objects
      results = response.records.map((rec: any) => ({
        id: rec.id,
        fields: rec.fields
      }));
    } else {
      // Map to standardized domain types
      results = response.records.map((rec: any) => mapper(rec.id, rec.fields));
    }

    // 4. Update in-memory cache
    cache[cacheKey] = {
      timestamp: Date.now(),
      data: results
    };

    // Filter results if deal reference was queried
    if (ref) {
      const filtered = filterResults(results, type, ref, targetDealId);
      return res.status(200).json(filtered);
    }

    // Apply Edge CDN headers
    if (type !== "inbox") {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=30");
    }

    return res.status(200).json(results);
  } catch (err: any) {
    console.error(`[API Deals Error] Type: ${type || "deals"}, Error: ${err.message || err}`);
    return res.status(err.status || 500).json({
      error: err.message || "Failed to load database records",
      type: err.type || "INTERNAL_ERROR"
    });
  }
}

/**
 * Filter results dynamically based on reference or parent link
 */
function filterResults(data: any[], type: string | undefined, ref: string, targetDealId?: string | null): any {
  const lowercaseRef = ref.toLowerCase();
  const lowercaseDealId = targetDealId?.toLowerCase();
  
  if (type === "documents" || type === "submissions") {
    return data.filter((item: any) => {
      const itemRef = item.dealRef || "";
      return itemRef.toLowerCase() === lowercaseRef || (lowercaseDealId && itemRef.toLowerCase() === lowercaseDealId);
    });
  }
  
  // Deals list filter
  return data.find((item: any) => {
    const itemRef = item.dealRef || "";
    return itemRef.toLowerCase() === lowercaseRef;
  }) || null;
}

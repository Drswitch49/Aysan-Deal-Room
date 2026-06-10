import { airtableFetchAll, airtableCreate } from "../src/lib/airtable/client.js";
import { TABLES } from "../src/lib/airtable/schema.js";
import { escapeFormulaString, buildAndFormula, buildOrFormula } from "../src/lib/airtable/queries.js";
import { authenticateAdmin } from "./admin/lenders_auth_helper.js";
import { authenticateLender } from "./lender/deals.js";
import { getSessionToken, verifyJWT } from "./_utils/jwt.js";

// In-memory cache for chat endpoints
interface ChatCacheEntry {
  timestamp: number;
  data: any;
}

const chatCache: Record<string, ChatCacheEntry> = {};
const CACHE_TTL_MS = 15000; // 15 seconds cache

export default async function handler(req: any, res: any) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(455).json({ error: "Method not allowed" });
  }

  try {
    const token = getSessionToken(req);
    if (!token) {
      return res.status(401).json({ error: "Unauthorized. Missing session token." });
    }

    const decoded = await verifyJWT(token);
    if (!decoded) {
      return res.status(401).json({ error: "Unauthorized. Invalid session token." });
    }

    const isAdmin = decoded.role === "admin" || decoded.role === "analyst";
    const isLender = decoded.role === "lender";

    // 1. Resolve Auth Identity
    let adminAuth: any = null;
    let lenderAuth: any = null;
    
    if (isAdmin) {
      req.user = decoded;
    } else if (isLender) {
      lenderAuth = await authenticateLender(req);
    } else {
      return res.status(403).json({ error: "Forbidden. Unauthorized role." });
    }

    // Resolve target parameters
    let dealId = "";
    let lenderRecordId = "";
    let message = "";

    if (req.method === "GET") {
      dealId = req.query.dealId || "";
      lenderRecordId = req.query.lenderRecordId || "";
    } else {
      const body = req.body || {};
      dealId = body.dealId || "";
      lenderRecordId = body.lenderRecordId || "";
      message = body.message || "";
    }

    // Fetch pipeline and lenders lists for ID/Ref name resolution
    const [dealsRes, lendersRes] = await Promise.all([
      airtableFetchAll(TABLES.PIPELINE).catch(() => ({ records: [] })),
      airtableFetchAll(TABLES.LENDERS).catch(() => ({ records: [] }))
    ]);

    const dealLookup = new Map<string, string>();
    const dealDetailLookup = new Map<string, any>();
    dealsRes.records.forEach((rec: any) => {
      const id = rec.id;
      const refNo = rec.fields["REF No."] || rec.fields.Deal_Ref || rec.fields.dealRef || "";
      const dealName = rec.fields["Deal Name"] || "";
      const companyName = rec.fields["Company Name"] || rec.fields.Company_Name || "";

      dealLookup.set(id.toLowerCase(), id);
      if (refNo) dealLookup.set(String(refNo).toLowerCase(), id);
      if (dealName) dealLookup.set(String(dealName).toLowerCase(), id);
      if (companyName) dealLookup.set(String(companyName).toLowerCase(), id);
      
      dealDetailLookup.set(id, rec.fields);
    });

    const lenderLookup = new Map<string, string>();
    const lenderDetailLookup = new Map<string, any>();
    lendersRes.records.forEach((rec: any) => {
      const id = rec.id;
      const name = rec.fields.Name || "";
      const companyName = rec.fields.Company_Name || "";
      const lenderIdText = rec.fields.Lender_ID || "";

      lenderLookup.set(id.toLowerCase(), id);
      if (name) lenderLookup.set(String(name).toLowerCase(), id);
      if (companyName) lenderLookup.set(String(companyName).toLowerCase(), id);
      if (lenderIdText) lenderLookup.set(String(lenderIdText).toLowerCase(), id);

      lenderDetailLookup.set(id, rec.fields);
    });

    // Determine target identifiers
    let resolvedDealId = dealId ? (dealLookup.get(dealId.toLowerCase()) || dealId) : "";
    let resolvedLenderId = lenderRecordId ? (lenderLookup.get(lenderRecordId.toLowerCase()) || lenderRecordId) : "";

    if (!isAdmin && lenderAuth) {
      resolvedLenderId = lenderAuth.id;
    }

    // 2. Handle GET (Read Operations)
    if (req.method === "GET") {
      // Create a specific cache key for this query
      const cacheKey = `chat_${resolvedDealId || "all"}_${resolvedLenderId || "all"}`;
      
      // Serve from in-memory cache if active
      const cached = chatCache[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return res.status(200).json(cached.data);
      }

      let formula = "";

      if (!resolvedDealId) {
        // Fetch recent messages
        if (isAdmin) {
          // Admin sees all messages
          formula = "";
        } else {
          // Lender only sees their own messages
          const lenderName = lenderAuth.fields.Name || lenderAuth.normalizedFields.Company_Name || "";
          const lenderCompanyName = lenderAuth.normalizedFields.Company_Name || "";
          const lenderTextId = lenderAuth.normalizedFields.Lender_ID || "";

          const conditions = [
            `{Lender_ID} = '${escapeFormulaString(resolvedLenderId)}'`,
            lenderName ? `{Lender_ID} = '${escapeFormulaString(lenderName)}'` : "",
            lenderCompanyName ? `{Lender_ID} = '${escapeFormulaString(lenderCompanyName)}'` : "",
            lenderTextId ? `{Lender_ID} = '${escapeFormulaString(lenderTextId)}'` : ""
          ].filter(Boolean);
          formula = buildOrFormula("Lender_ID", conditions.map(c => c.split("'")[1])); // extracts text values
        }
      } else {
        // Fetch messages for a specific deal and lender
        const lenderFields = lenderDetailLookup.get(resolvedLenderId) || {};
        const lenderName = lenderFields.Name || lenderFields.Company_Name || "";
        const lenderCompanyName = lenderFields.Company_Name || "";
        const lenderTextId = lenderFields.Lender_ID || "";

        const dealFields = dealDetailLookup.get(resolvedDealId) || {};
        const dealRef = dealFields["REF No."] || dealFields.Deal_Ref || dealFields.dealRef || "";
        const dealName = dealFields["Deal Name"] || "";
        const dealCompany = dealFields["Company Name"] || dealFields.Company_Name || "";

        const lenderConditions = [
          `{Lender_ID} = '${escapeFormulaString(resolvedLenderId)}'`,
          lenderName ? `{Lender_ID} = '${escapeFormulaString(lenderName)}'` : "",
          lenderCompanyName ? `{Lender_ID} = '${escapeFormulaString(lenderCompanyName)}'` : "",
          lenderTextId ? `{Lender_ID} = '${escapeFormulaString(lenderTextId)}'` : ""
        ].filter(Boolean);

        const dealConditions = [
          `{Deal_Ref} = '${escapeFormulaString(resolvedDealId)}'`,
          dealRef ? `{Deal_Ref} = '${escapeFormulaString(dealRef)}'` : "",
          dealName ? `{Deal_Ref} = '${escapeFormulaString(dealName)}'` : "",
          dealCompany ? `{Deal_Ref} = '${escapeFormulaString(dealCompany)}'` : ""
        ].filter(Boolean);

        formula = `AND(OR(${lenderConditions.join(", ")}), OR(${dealConditions.join(", ")}))`;
      }

      const chatRes = await airtableFetchAll(TABLES.CHAT, {
        filterByFormula: formula || undefined
      });

      const messages = chatRes.records.map((rec: any) => {
        const rawDealVal = Array.isArray(rec.fields.Deal_Ref) ? rec.fields.Deal_Ref[0] : (rec.fields.Deal_Ref || "");
        const rawLenderVal = Array.isArray(rec.fields.Lender_ID) ? rec.fields.Lender_ID[0] : (rec.fields.Lender_ID || "");

        const dealRecordId = dealLookup.get(String(rawDealVal).toLowerCase()) || rawDealVal;
        const lenderRecordId = lenderLookup.get(String(rawLenderVal).toLowerCase()) || rawLenderVal;

        return {
          id: rec.id,
          dealId: dealRecordId,
          lenderId: lenderRecordId,
          sender: rec.fields.Sender || "",
          message: rec.fields.Message || "",
          timestamp: rec.fields.Timestamp || rec.createdTime || ""
        };
      });

      // Sort messages (ascending for conversation view, descending for summary)
      if (resolvedDealId) {
        messages.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      } else {
        messages.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      }

      // Update cache
      chatCache[cacheKey] = {
        timestamp: Date.now(),
        data: messages
      };

      return res.status(200).json(messages);
    }

    // 3. Handle POST (Write Operations)
    if (req.method === "POST") {
      if (!resolvedDealId) {
        return res.status(400).json({ error: "Deal ID is required to send messages." });
      }
      if (!message || message.trim() === "") {
        return res.status(400).json({ error: "Message cannot be empty." });
      }

      const senderName = isAdmin ? "Admin" : (lenderAuth.normalizedFields.Company_Name || "Lender");

      const newRecord = await airtableCreate(TABLES.CHAT, {
        Lender_ID: [resolvedLenderId],
        Deal_Ref: [resolvedDealId],
        Sender: senderName,
        Message: message,
        Timestamp: new Date().toISOString()
      });

      const mapped = {
        id: newRecord.id,
        dealId: resolvedDealId,
        lenderId: resolvedLenderId,
        sender: newRecord.fields.Sender || senderName,
        message: newRecord.fields.Message || message,
        timestamp: newRecord.fields.Timestamp || newRecord.createdTime || new Date().toISOString()
      };

      // Invalidate all associated cache items so write-through works instantly
      const cacheKeyWithRefs = `chat_${resolvedDealId}_${resolvedLenderId}`;
      const cacheKeyAllDeals = `chat_all_${resolvedLenderId}`;
      const cacheKeyAdminAll = `chat_all_all`;

      delete chatCache[cacheKeyWithRefs];
      delete chatCache[cacheKeyAllDeals];
      delete chatCache[cacheKeyAdminAll];

      return res.status(200).json(mapped);
    }

  } catch (err: any) {
    if (err.status === 404 || err.type === "TABLE_NOT_FOUND") {
      return res.status(404).json({
        error: "Chat table not setup",
        type: "TABLE_NOT_FOUND",
        message: "The 'Chat_Messages' table was not found in Airtable."
      });
    }
    return res.status(err.status || 500).json({ error: err.message });
  }
}

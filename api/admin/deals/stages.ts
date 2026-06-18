import { authenticateAdmin } from "../lenders.js";
import { getTableSchema } from "../../_utils/airtable.js";

export default async function handler(req: any, res: any) {
  try {
    await authenticateAdmin(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const FALLBACK_STAGES = [
      "Intro",
      "NDA Signed",
      "Information Requested",
      "LOI Drafted",
      "LOI Submitted",
      "Killed",
      "Due Diligence",
      "IC Decision",
      "IM Review",
      "Seller Call",
      "Offer Submitted"
    ];

    const schema = await getTableSchema("Active_Pipeline");
    if (!schema || !schema.fields) {
      return res.status(200).json({ success: true, stages: FALLBACK_STAGES });
    }

    const stageField = schema.fields.find((f: any) => f.name === "Stage");
    if (!stageField || !stageField.options?.choices) {
      return res.status(200).json({ success: true, stages: FALLBACK_STAGES });
    }

    const choices = stageField.options.choices.map((c: any) => c.name);
    return res.status(200).json({ success: true, stages: choices });
  } catch (err: any) {
    console.error("[GET Stages API Error] ", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error"
    });
  }
}

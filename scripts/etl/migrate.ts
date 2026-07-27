/**
 * ONE-TIME ETL — migrate all Airtable data into Supabase (Phase 1b).
 *
 * Runs idempotently: a record already recorded in etl_id_map is skipped, so the
 * script can be re-run safely. Loads in FK-safe order and prints a per-table
 * reconciliation (Airtable rows vs migrated).
 *
 *   node --env-file=.env --import tsx scripts/etl/migrate.ts            # data only
 *   node --env-file=.env --import tsx scripts/etl/migrate.ts --files    # + rehost files to Cloudinary
 *   node --env-file=.env --import tsx scripts/etl/migrate.ts <Table>    # single table
 */
import { fetchAllRecords, type AirtableRecord } from "./_client.js";
import { insertRow, updateRow, upsertRow, closeDb } from "./_db.js";
import {
  str, num, int, bool, ts, dateOnly, firstStr, firstLinkId, linkIds, attachments,
  loadIdMap, setId, getId, resolveDealId,
} from "./_helpers.js";
import { uploadFromUrl } from "../../lib/core/cloudinary.js";

const REHOST_FILES = process.argv.includes("--files");
const ONLY = process.argv.slice(2).find((a) => !a.startsWith("--"));

const recon: Array<{ table: string; source: number; migrated: number; skipped: number; note?: string }> = [];

/** Insert a row, return its new uuid. */
async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  return insertRow(table, row);
}

async function update(table: string, id: string, row: Record<string, unknown>): Promise<void> {
  return updateRow(table, id, row);
}

/** Best-effort rehost of a remote file URL to Cloudinary. Returns null on failure/skip. */
async function rehost(url: string | null, folder: string): Promise<{ publicId: string; url: string } | null> {
  if (!url || !REHOST_FILES) return null;
  try {
    const asset = await uploadFromUrl(url, { folder });
    return { publicId: asset.publicId, url: asset.secureUrl };
  } catch (err) {
    console.warn(`   ⚠ file rehost failed (${url.slice(0, 60)}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Insert or upsert-on-conflict, returning the row's uuid. */
async function upsertOn(table: string, row: Record<string, unknown>, conflict: string): Promise<string> {
  return upsertRow(table, row, conflict.split(",").map((c) => c.trim()));
}

/** Generic loader: transform each record, skip if already migrated. */
async function load(
  sourceTable: string,
  targetTable: string,
  transform: (r: AirtableRecord) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>,
  opts: { conflictColumn?: string } = {},
): Promise<void> {
  if (ONLY && ONLY !== sourceTable) return;
  const records = await fetchAllRecords(sourceTable);
  let migrated = 0, skipped = 0;
  for (const r of records) {
    if (getId(sourceTable, r.id)) { skipped++; continue; }
    const row = await transform(r);
    if (!row) { skipped++; continue; }
    // With conflict column(s), all must be non-null to dedupe → else plain insert.
    const conflictCols = opts.conflictColumn?.split(",").map((c) => c.trim()) ?? [];
    const useUpsert = conflictCols.length > 0 && conflictCols.every((c) => row[c] != null);
    const id = useUpsert
      ? await upsertOn(targetTable, { ...row, airtable_id: r.id }, opts.conflictColumn!)
      : await insert(targetTable, { ...row, airtable_id: r.id });
    await setId(sourceTable, r.id, targetTable, id);
    migrated++;
  }
  recon.push({ table: `${sourceTable} → ${targetTable}`, source: records.length, migrated, skipped });
  console.log(`  ✓ ${sourceTable} → ${targetTable}: ${migrated} migrated, ${skipped} skipped`);
}

// ─── Role mapping ──────────────────────────────────────────────────────────
function mapRole(v: unknown): string {
  const s = (str(v) || "").toLowerCase();
  if (s.includes("owner") || s.includes("super")) return "owner";
  if (s.includes("managing")) return "managing_partner";
  if (s === "partner") return "partner";
  if (s.includes("analyst")) return "analyst";
  if (s === "hr") return "hr";
  if (s === "admin") return "admin";
  return "read_only";
}

// ═══════════════════════════════════════════════════════════════════════════
//  People / standalone tables
// ═══════════════════════════════════════════════════════════════════════════
async function migratePeople() {
  await load("Users", "profiles", (r) => {
    const f = r.fields;
    return {
      email: str(f["Email"]) ?? `unknown-${r.id}@placeholder.local`,
      full_name: str(f["Name"]) ?? str(f["Full Name"]),
      role: mapRole(f["Role"]),
      status: (str(f["Status"]) || "active").toLowerCase(),
      legacy_password_hash: str(f["PasswordHash"]),
      permissions: str(f["Permissions"]),
      last_login_at: ts(f["LastLogin"]),
    };
  }, { conflictColumn: "email" });

  await load("ACP_Team", "acp_team", (r) => {
    const f = r.fields;
    return {
      name: str(f["Name"]) ?? "Unnamed",
      role: str(f["Role"]),
      initials: str(f["Initials"]),
      access_level: str(f["Access_Level"]),
      avatar_theme: str(f["Avatar_Theme"]),
      sort_order: int(f["Order"]),
      email: str(f["Email"]),
      phone: str(f["Phone"]),
      status: (str(f["Status"]) || "active").toLowerCase(),
      login_link: str(f["Login_Link"]),
    };
  });

  await load("Lenders", "lenders", (r) => {
    const f = r.fields;
    return {
      lender_ref: str(f["Lender_ID"]),
      name: str(f["Name"]),
      company_name: str(f["Company_Name"]),
      contact_name: str(f["Contact_Name"]),
      email: str(f["Email"]),
      phone: str(f["Phone Number"]),
      portal_slug: str(f["Portal_Slug"]),
      legacy_password_hash: str(f["Portal_Password"]),
      nda_approved: bool(f["NDA_APPROVED"]),
      criteria_pills: str(f["Criteria_Pills"]),
      last_contact_date: dateOnly(f["Last_Contact_Date"]),
    };
  }, { conflictColumn: "portal_slug" });

  await load("Shareholders", "shareholders", (r) => {
    const f = r.fields;
    return {
      name: str(f["Name"]),
      email: str(f["Email"]),
      phone: str(f["Phone"]),
      status: (str(f["Status"]) || "active").toLowerCase(),
      notes: str(f["Notes"]),
      last_login_at: ts(f["Last_Login"]),
    };
  });

  await load("External_Stakeholders", "external_stakeholders", (r) => {
    const f = r.fields;
    return {
      name: str(f["Name"]) ?? "Unnamed",
      association: str(f["Association"]),
      organization: str(f["Organization"]),
      company: str(f["Company"]),
      type: str(f["Type"]),
      description: str(f["Description"]),
      notes: str(f["Notes"]),
      accent_color: str(f["Accent_Color"]),
      email: str(f["Email"]),
      phone: str(f["Phone"]),
      status: (str(f["Status"]) || "active").toLowerCase(),
      login_link: str(f["Login_Link"]),
    };
  });

  await load("Hiring_Briefs", "hiring_briefs", (r) => {
    const f = r.fields;
    return {
      role: str(f["Role"]) ?? "Unspecified",
      company: str(f["Company"]),
      status_text: str(f["Status_Text"]),
      accent_color: str(f["Accent_Color"]),
    };
  });

  await load("Portfolio_Companies", "portfolio_companies", (r) => {
    const f = r.fields;
    return {
      company_name: str(f["Company_Name"]) ?? "Unnamed",
      industry: str(f["Industry"]),
      location: str(f["Location"]),
      status: (str(f["Status"]) || "active").toLowerCase(),
      revenue: num(f["Revenue"]),
      ebitda: num(f["EBITDA"]),
      debt: num(f["Debt"]),
      headcount: int(f["Headcount"]),
      notes: str(f["Notes"]),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Deals — consolidate Deal_Inbox + Review_Queue + Active_Pipeline + Archive
// ═══════════════════════════════════════════════════════════════════════════
async function migrateDeals() {
  if (ONLY && ONLY !== "deals") return;

  // 1) Deal_Inbox → one deal each (stage inbox)
  const inbox = await fetchAllRecords("Deal_Inbox");
  let created = 0, skipped = 0;
  for (const r of inbox) {
    if (getId("Deal_Inbox", r.id)) { skipped++; continue; }
    const f = r.fields;
    const id = await insert("deals", {
      stage: "inbox",
      ref_no: str(f["REF. NO"]),
      deal_name: str(f["Deal Name"]),
      sector: str(f["Sector"]),
      source: str(f["Source"]),
      status: str(f["Status"]),
      ai_verdict: str(f["AI_Verdict"]),
      broker: str(f["BROKER"]),
      contact_email: str(f["Contact E-mail"]),
      contact_phone: str(f["Contact Call Line "]),
      listing_link: str(f["Listing Link"]),
      deal_files_url: firstStr(f["Deal Files"]),
      location: str(f["Location"]),
      turnover: num(f["Turnover"]),
      ebitda_gbp: num(f["EBITDA_GBP"]),
      asking_price_gbp: num(f["Asking_Price_GBP"]),
      business_description: str(f["Business Description"]),
      executive_summary: str(f["Executive Summary"]),
      one_line_reason: str(f["One Line Reason"]),
      total_score: num(f["Total Score"]),
      dscr_proxy: num(f["DSCR_Proxy"]),
      dscr_score: num(f["DSCR_Score"]),
      sector_score: num(f["Sector_score"]),
      revenue_scale_score: num(f["Revenue_scale_score"]),
      ebitda_quality_score: num(f["Ebitda_quality_score"]),
      recurring_revenue_score: num(f["Recurring_revenue_score"]),
      customer_concentration_score: num(f["Customer_concentration_score"]),
      management_score: num(f["Management_score"]),
      market_position_score: num(f["Market_position_score"]),
      growth_score: num(f["Growth Score"]),
      capital_intensity_score: num(f["Capital_intensity_score"]),
      exit_score: num(f["Exit Score"]),
      revenue_per_employee_score: num(f["Revenue_per_employee_score"]),
      assigned_to: str(f["Assigned To"]),
      date_added: ts(f["Date Added"]),
      airtable_inbox_id: r.id,
    });
    await setId("Deal_Inbox", r.id, "deals", id);
    created++;
  }
  console.log(`  ✓ Deal_Inbox → deals: ${created} created, ${skipped} skipped`);
  recon.push({ table: "Deal_Inbox → deals", source: inbox.length, migrated: created, skipped });

  // 2) Review_Queue → merge into linked deal (stage review) or create
  const review = await fetchAllRecords("Review_Queue");
  let rMerged = 0, rCreated = 0;
  for (const r of review) {
    if (getId("Review_Queue", r.id)) continue;
    const f = r.fields;
    const dealId = resolveDealId(f["Deal_Name"]);
    const patch = {
      partner_review: str(f["Partner Review"]),
      kill_reason_select: str(f["Kill Reason (Single Select)"]),
      kill_reason_text: str(f["Kill Reason (Free Text)"]),
      information_needed: str(f["Information Needed"]),
      associate_recommendation: str(f["Acquisition Associate - Dallience_Recommendation"]),
      decision_date: ts(f["Decision_Date"]),
      airtable_review_id: r.id,
    };
    if (dealId) {
      await update("deals", dealId, { ...patch, stage: "review" });
      await setId("Review_Queue", r.id, "deals", dealId);
      rMerged++;
    } else {
      const id = await insert("deals", { ...patch, stage: "review", deal_name: firstStr(f["Deal Name"]) });
      await setId("Review_Queue", r.id, "deals", id);
      rCreated++;
    }
  }
  console.log(`  ✓ Review_Queue → deals: ${rMerged} merged, ${rCreated} created`);
  recon.push({ table: "Review_Queue → deals", source: review.length, migrated: rMerged + rCreated, skipped: 0, note: `${rMerged} merged` });

  // 3) Active_Pipeline → merge into linked deal (stage active) or create
  const pipeline = await fetchAllRecords("Active_Pipeline");
  let pMerged = 0, pCreated = 0;
  for (const r of pipeline) {
    if (getId("Active_Pipeline", r.id)) continue;
    const f = r.fields;
    const dealId = resolveDealId(f["Deal_Inbox"]);
    const patch: Record<string, unknown> = {
      acp_ref_no: str(f["ACP REF NO"]),
      company_name: str(f["Company_Name"]),
      project_name: str(f["Project_Name"]),
      industry: str(f["Industry"]),
      website: str(f["Website"]),
      deal_type: str(f["Deal_Type"]),
      pipeline_stage: str(f["Stage"]),
      next_action: str(f["Next Action"]),
      next_action_date: dateOnly(f["Next Action Date"]),
      owner: str(f["Owner"]),
      analyst: str(f["Analyst"]),
      assigned_to: str(f["Assigned To"]),
      enterprise_value: num(f["Enterprise_Value"]),
      internal_notes: str(f["Internal_Notes"]),
      lender_executive_summary: str(f["Lender_Executive_Summary"]),
      investment_highlights: str(f["Investment_Highlights"]),
      acquisition_rationale: str(f["Acquisition_Rationale"]),
      claude_verdict: str(f["Claude_Verdict"]),
      date_advanced: ts(f["Date_Advanced"]),
      airtable_pipeline_id: r.id,
      // prefer canonical pipeline values where present
      company_name_fallback: undefined,
    };
    // Fill fields that pipeline carries directly (for unlinked deals)
    const own = {
      deal_name: str(f["Deal Name"]),
      location: str(f["Location"]),
      turnover: num(f["Turnover"]),
      ebitda_gbp: num(f["EBITDA_GBP"]),
      asking_price_gbp: num(f["Asking_Price_GBP"]),
      contact_email: str(f["Contact_Email"]),
      contact_phone: str(f["Contact_Phone"]),
      listing_link: str(f["Listing_Link"]),
      executive_summary: str(f["Executive_Summary"]),
      business_description: str(f["Business_Description"]),
      ref_no: firstStr(f["REF No."]),
    };
    delete (patch as any).company_name_fallback;
    if (dealId) {
      // Merge: only set own.* if the deal doesn't already have them (avoid nulling inbox data)
      await update("deals", dealId, { ...patch, stage: "active" });
      await setId("Active_Pipeline", r.id, "deals", dealId);
      pMerged++;
    } else {
      const id = await insert("deals", { ...patch, ...own, stage: "active" });
      await setId("Active_Pipeline", r.id, "deals", id);
      pCreated++;
    }
  }
  console.log(`  ✓ Active_Pipeline → deals: ${pMerged} merged, ${pCreated} created`);
  recon.push({ table: "Active_Pipeline → deals", source: pipeline.length, migrated: pMerged + pCreated, skipped: 0, note: `${pMerged} merged` });

  // 4) Archive → mark linked deal archived or create
  const archive = await fetchAllRecords("Archive");
  let aMerged = 0, aCreated = 0;
  for (const r of archive) {
    if (getId("Archive", r.id)) continue;
    const f = r.fields;
    const dealId = resolveDealId(f["Deal Name"]) ?? resolveDealId(f["Review_Queue"]);
    const patch = {
      killed_by: str(f["Killed_By"]),
      kill_date: ts(f["Kill_Date"]),
      airtable_archive_id: r.id,
    };
    if (dealId) {
      await update("deals", dealId, { ...patch, stage: "archived" });
      await setId("Archive", r.id, "deals", dealId);
      aMerged++;
    } else {
      const id = await insert("deals", { ...patch, stage: "archived", deal_name: str(f["Deal Name."]) });
      await setId("Archive", r.id, "deals", id);
      aCreated++;
    }
  }
  console.log(`  ✓ Archive → deals: ${aMerged} merged, ${aCreated} created`);
  recon.push({ table: "Archive → deals", source: archive.length, migrated: aMerged + aCreated, skipped: 0, note: `${aMerged} merged` });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Deal children + AI + portfolio + audit
// ═══════════════════════════════════════════════════════════════════════════
async function migrateChildren() {
  await load("Documents", "documents", async (r) => {
    const f = r.fields;
    const driveLink = str(f["Drive_Link"]);
    const hosted = await rehost(driveLink, "aysan-deal-room/documents");
    return {
      deal_id: resolveDealId(f["Deal_Ref"]),
      doc_key: str(f["Doc_Key"]),
      document_name: str(f["Document_Name"]),
      category: str(f["Category"]),
      abl_critical: bool(f["ABL_Critical"]),
      status: str(f["Status"]),
      source: str(f["Source"]),
      date_received: dateOnly(f["Date_Received"]),
      expected_date: dateOnly(f["Expected_Date"]),
      date_sent_to_lender: dateOnly(f["Date_Sent_To_Lender"]),
      lender_target: str(f["Lender_Target"]),
      document_access: str(f["Document_Access"]),
      internal_notes: str(f["Internal_Notes"]),
      cloudinary_public_id: hosted?.publicId ?? null,
      file_url: hosted?.url ?? null,
      legacy_drive_link: driveLink,
      extracted_text: str(f["Extracted_Text"]),
      summary: str(f["Summary"]),
      risks: str(f["Risks"]),
      covenants: str(f["Covenants"]),
      metrics: str(f["Metrics"]),
      processing_status: str(f["Processing_Status"]),
      processing_error: str(f["Processing_Error"]),
      processing_started_at: ts(f["Processing_Started_At"]),
      processed_at: ts(f["Processed_At"]),
    };
  });

  await load("IM_Review_Documents", "im_review_documents", async (r) => {
    const f = r.fields;
    const fileUrl = str(f["File_Url"]);
    const hosted = await rehost(fileUrl, "aysan-deal-room/im");
    return {
      legacy_deal_ref: str(f["Deal_Ref"]),
      document_name: str(f["Document_Name"]),
      file_type: str(f["File_Type"]),
      cloudinary_public_id: hosted?.publicId ?? null,
      file_url: hosted?.url ?? null,
      legacy_file_url: fileUrl,
      uploaded_by: str(f["Uploaded_By"]),
      uploaded_at: ts(f["Uploaded_At"]),
      file_size: int(f["File_Size"]),
    };
  });

  await load("Submission_Log", "submission_log", (r) => {
    const f = r.fields;
    return {
      deal_id: resolveDealId(f["Deal_Ref"]),
      submitted_on: dateOnly(f["Date"]),
      what_was_sent: str(f["What_Was_Sent"]),
      sent_to: str(f["Sent_To"]),
      sent_via: str(f["Sent_Via"]),
      response_received: str(f["Response_Received"]),
      flag: str(f["Flag"]),
    };
  });

  await load("Lender_Deal_Assignments", "lender_deal_assignments", (r) => {
    const f = r.fields;
    const lenderAtId = firstLinkId(f["Lenders_ID"]);
    return {
      assignment_ref: str(f["Assignment_ID"]),
      lender_id: lenderAtId ? getId("Lenders", lenderAtId) : null,
      deal_id: resolveDealId(f["Deal_Ref"]),
    };
  }, { conflictColumn: "lender_id,deal_id" });

  await load("Shareholder_Deal_Assignments", "shareholder_deal_assignments", (r) => {
    const f = r.fields;
    return {
      shareholder_id: null, // Airtable stores free-text Shareholder_ID; table empty anyway
      deal_id: resolveDealId(f["Deal_Ref"]),
      assigned_at: ts(f["Assigned_At"]),
    };
  });

  await load("Chat_Messages", "chat_messages", (r) => {
    const f = r.fields;
    const lenderAtId = firstLinkId(f["Lender_ID"]);
    return {
      deal_id: resolveDealId(f["Deal_Ref"]),
      lender_id: lenderAtId ? getId("Lenders", lenderAtId) : null,
      sender: str(f["Sender"]),
      message: str(f["Message"]),
    };
  });

  await load("Deal_Notes", "deal_notes", (r) => {
    const f = r.fields;
    return {
      deal_id: resolveDealId(f["Linked Record"]),
      legacy_deal_ref: str(f["Deal_Ref"]),
      note_content: str(f["Note_Content"]) ?? str(f["Notes"]),
      status: str(f["Status"]),
      author: str(f["Author"]),
      author_email: str(f["Author_Email"]),
    };
  });

  await load("Deal_Stage_History", "deal_stage_history", (r) => {
    const f = r.fields;
    return {
      deal_id: null, // Airtable stores free-text Deal_Ref/Deal_ID, not a link
      legacy_deal_ref: str(f["Deal_Ref"]) ?? str(f["Deal_ID"]),
      company_name: str(f["Company_Name"]),
      from_stage: str(f["From_Stage"]),
      to_stage: str(f["To_Stage"]),
      from_stage_label: str(f["From_Stage_Label"]),
      to_stage_label: str(f["To_Stage_Label"]),
      changed_by: str(f["Changed_By"]),
      changed_by_role: str(f["Changed_By_Role"]),
      changed_at: ts(f["Changed_At"]),
      notes: str(f["Notes"]),
      transition_valid: bool(f["Transition_Valid"]),
    };
  });
}

async function migrateAI() {
  await load("Transcript_Analyses", "transcript_analyses", (r) => {
    const f = r.fields;
    return {
      deal_id: resolveDealId(f["Deal Name"]),
      name: str(f["Name"]),
      transcript: str(f["Transcript"]),
      processing_status: str(f["Processing_Status"]),
      processing_error: str(f["Processing_Error"]),
      processing_started_at: ts(f["Processing_Started_At"]),
      processed_at: ts(f["Processed_At"]),
    };
  });

  const briefTransform = (r: AirtableRecord) => {
    const f = r.fields;
    let brief: unknown = null;
    const raw = str(f["Brief Data"]);
    if (raw) { try { brief = JSON.parse(raw); } catch { brief = { raw }; } }
    return {
      deal_id: resolveDealId(f["Active_Pipeline"]),
      name: str(f["Name"]),
      website: str(f["Website"]),
      brief_data: brief,
      processing_status: str(f["Processing_Status"]),
      processing_error: str(f["Processing_Error"]),
      processing_started_at: ts(f["Processing_Started_At"]),
      processed_at: ts(f["Processed_At"]),
    };
  };
  await load("Precall_Briefs", "precall_briefs", briefTransform);
  await load("Postcall_Briefs", "postcall_briefs", briefTransform);
}

async function migratePortfolio() {
  const matchCompany = (name: string | null) => {
    // best-effort: portfolio_* key off free-text names, not links → leave FK null, keep legacy id.
    return null as string | null;
  };
  await load("Portfolio_Metrics", "portfolio_metrics", (r) => {
    const f = r.fields;
    return {
      company_id: matchCompany(str(f["Company_Name"])),
      legacy_company_id: str(f["Company_Id"]),
      company_name: str(f["Company_Name"]),
      reporting_period: str(f["Reporting_Period"]),
      revenue: num(f["Revenue"]),
      ebitda: num(f["EBITDA"]),
      dscr: num(f["DSCR"]),
      leverage: num(f["Leverage"]),
      headcount: int(f["Headcount"]),
      churn_rate: num(f["Churn_Rate"]),
      recurring_revenue: num(f["Recurring_Revenue"]),
    };
  });
  await load("Portfolio_Alerts", "portfolio_alerts", (r) => {
    const f = r.fields;
    return {
      company_id: matchCompany(str(f["Company_Name"])),
      legacy_company_id: str(f["Company_Id"]),
      company_name: str(f["Company_Name"]),
      alert_type: str(f["Alert_Type"]),
      severity: str(f["Severity"]),
      explanation: str(f["Explanation"]),
      triggered_at: ts(f["Triggered_At"]),
      resolved_at: ts(f["Resolved_At"]),
    };
  });
  await load("Portfolio_Health", "portfolio_health", (r) => {
    const f = r.fields;
    return {
      company_id: matchCompany(str(f["Company_Name"])),
      legacy_company_id: str(f["Company_Id"]),
      company_name: str(f["Company_Name"]),
      portfolio_score: num(f["Portfolio_Score"]),
      risk_level: str(f["Risk_Level"]),
      active_alerts: int(f["Active_Alerts"]),
      trend_summary: str(f["Trend_Summary"]),
      updated_at: ts(f["Updated_At"]),
    };
  });
}

async function migrateAudit() {
  await load("Audit_Logs", "audit_logs", (r) => {
    const f = r.fields;
    return {
      action: str(f["Action"]),
      event_type: str(f["Event_Type"]),
      entity_type: str(f["Entity_Type"]),
      entity_id: str(f["Entity_Id"]),
      operator: str(f["Operator"]),
      operator_role: str(f["Operator_Role"]),
      user_id: str(f["User_Id"]),
      target: str(f["Target"]),
      details: str(f["Details"]),
      changes: str(f["Changes"]),
      ip_address: str(f["IP_Address"]),
      occurred_at: ts(f["Timestamp"]),
    };
  });
}

async function main() {
  console.log(`\nETL start${REHOST_FILES ? " (with file rehosting)" : " (data only)"}${ONLY ? ` — table: ${ONLY}` : ""}\n`);
  await loadIdMap();

  await migratePeople();
  await migrateDeals();
  await migrateChildren();
  await migrateAI();
  await migratePortfolio();
  await migrateAudit();

  console.log("\n── Reconciliation ──");
  for (const r of recon) {
    console.log(`  ${r.table}: source=${r.source} migrated=${r.migrated} skipped=${r.skipped}${r.note ? ` (${r.note})` : ""}`);
  }
  console.log("\nETL complete.\n");
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error("\nETL FAILED:", err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });

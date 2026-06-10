import type { RawAirtableFields } from "../../types/airtable";
import type { DealDocument, PipelineDeal, SubmissionLogEntry } from "../../types/deal";
import { asBoolean, asText, asUrl, firstField } from "../../utils/fields";

export function mapPipelineDeal(id: string, fields: RawAirtableFields): PipelineDeal {
  return {
    id,
    dealRef: asText(firstField(fields, ["Deal_Ref", "Deal Ref", "Deal Reference", "REF No.", "Ref No.", "Deal Name"])),
    companyName: asText(firstField(fields, ["Company_Name", "Company Name", "company name", "Company", "Deal Name"])),
    status: asText(firstField(fields, ["Status", "Deal_Status", "Deal Status", "Stage"])),
    location: asText(firstField(fields, ["Location", "Company Location", "HQ", "Headquarters"])),
    sector: asText(firstField(fields, ["Sector", "Industry"])),
    ev: asText(firstField(fields, ["EV", "Enterprise Value", "Enterprise_Value", "EV Multiple"])),
    dscrBase: asText(firstField(fields, ["DSCR_Base", "DSCR Base", "DSCR base", "DSCR_Proxy", "DSCR Proxy"])),
    dscrStress: asText(firstField(fields, ["DSCR_Stress", "DSCR Stress", "DSCR stress", "DSCR_SCORE", "DSCR Score"])),
    broker: asText(firstField(fields, ["Broker", "Broker_Name", "Broker Name"])),
    lenderAssigned: asText(firstField(fields, ["Lender_Assigned", "Lender Assigned", "Lender"])),
    vendorNames: asText(firstField(fields, ["Vendor_Names", "Vendor Names", "Vendor Details", "vendor details"])),
    postCompletionRoles: asText(
      firstField(fields, ["Post_Completion_Roles", "Post-Completion Roles", "Post Completion Roles"]),
    ),
    capitalStructure: buildCapitalStructure(fields),
    rawFields: fields,
    dealFiles: asUrl(firstField(fields, ["Deal Files", "Deal_Files", "deal_files", "Deal Link", "Drive_Link", "Drive Link", "Link", "link"])),
  };
}

export function mapDocument(id: string, fields: RawAirtableFields): DealDocument {
  return {
    id,
    dealRef: asText(firstField(fields, ["Deal_Ref", "Deal Ref", "Deal Reference"])),
    documentName: asText(firstField(fields, ["Document_Name", "Document Name", "Name"])),
    category: asText(firstField(fields, ["Category", "category"])),
    ablCritical: asBoolean(firstField(fields, ["ABL_Critical", "ABL Critical", "abl_critical", "abl critical", "Critical"])),
    status: asText(firstField(fields, ["Status", "status", "Stage"])),
    source: asText(firstField(fields, ["Source", "source"])),
    dateReceived: asText(firstField(fields, ["Date_Received", "Date Received", "date_received", "date received", "Date"])),
    driveLink: asUrl(firstField(fields, ["drive link", "Drive Link", "Drive_Link", "drive_link", "Link", "link"])),
    expectedDate: asText(firstField(fields, ["Expected_Date", "Expected Date", "expected_date", "expected date"])),
    internalNotes: asText(firstField(fields, ["Internal_Notes", "Internal Notes", "Notes", "notes"])),
    dateSentToLender: asText(firstField(fields, ["Date_Sent_To_Lender", "Date Sent To Lender", "date_sent_to_lender", "date sent to lender"])),
    lenderTarget: asText(firstField(fields, ["Lender_Target", "Lender Target", "lender_target", "lender target"])),
  };
}

export function mapSubmissionLogEntry(id: string, fields: RawAirtableFields): SubmissionLogEntry {
  return {
    id,
    dealRef: asText(firstField(fields, ["Deal_Ref", "Deal Ref", "Deal Reference"])),
    date: asText(firstField(fields, ["Date", "date"])),
    whatWasSent: asText(firstField(fields, ["What_Was_Sent", "What Was Sent", "what was sent"])),
    sentTo: asText(firstField(fields, ["Sent_To", "Sent To", "sent to"])),
    sentVia: asText(firstField(fields, ["Sent_Via", "Sent Via", "sent via"])),
    responseReceived: asText(firstField(fields, ["Response_Received", "Response Received", "response received"])),
    flag: asText(firstField(fields, ["Flag", "flag"])),
  };
}

function buildCapitalStructure(fields: RawAirtableFields) {
  const rows = [
    {
      label: "Senior Debt",
      provider: asText(firstField(fields, ["Senior_Debt_Provider", "Senior Debt Provider", "Senior Lender"])),
      amount: asText(firstField(fields, ["Senior_Debt", "Senior Debt", "Senior Debt Amount"])),
      notes: asText(firstField(fields, ["Senior_Debt_Notes", "Senior Debt Notes"])),
    },
    {
      label: "Subordinated Debt",
      provider: asText(firstField(fields, ["Sub_Debt_Provider", "Sub Debt Provider", "Subordinated Debt Provider"])),
      amount: asText(firstField(fields, ["Sub_Debt", "Sub Debt", "Subordinated Debt"])),
      notes: asText(firstField(fields, ["Sub_Debt_Notes", "Sub Debt Notes"])),
    },
    {
      label: "Equity",
      provider: asText(firstField(fields, ["Equity_Provider", "Equity Provider"])),
      amount: asText(firstField(fields, ["Equity", "Equity Amount"])),
      notes: asText(firstField(fields, ["Equity_Notes", "Equity Notes"])),
    },
    {
      label: "Seller Note",
      provider: asText(firstField(fields, ["Seller_Note_Provider", "Seller Note Provider"])),
      amount: asText(firstField(fields, ["Seller_Note", "Seller Note"])),
      notes: asText(firstField(fields, ["Seller_Note_Notes", "Seller Note Notes"])),
    },
  ];

  return rows.filter((row) => row.provider || row.amount || row.notes);
}

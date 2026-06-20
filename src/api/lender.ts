import type { DealDocument, PipelineDeal, SubmissionLogEntry } from "../types/deal";

// Retrieve lender credentials from sessionStorage
const getLenderHeaders = (portalSlug: string): Record<string, string> => {
  return {
    "x-lender-slug": portalSlug
  };
};

export async function loginLender(portalSlug: string, passcode: string) {
  const response = await fetch("/api/lender/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ portalSlug, password: passcode })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Incorrect portal credentials");
  }

  return response.json();
}

export async function fetchLenderDeals(portalSlug: string): Promise<PipelineDeal[]> {
  const response = await fetch("/api/lender/deals", {
    headers: getLenderHeaders(portalSlug)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load assigned deals");
  }

  const rawDeals = await response.json();
  
  // Map raw fields to PipelineDeal format
  return rawDeals.map((rec: any) => ({
    id: rec.id,
    dealRef: rec.fields["REF No."] || rec.fields.Deal_Ref || rec.fields.dealRef || rec.fields["Deal Name"] || "",
    companyName: rec.fields["Company Name"] || rec.fields.Company_Name || rec.fields.companyName || "",
    status: rec.fields.Status || rec.fields.Deal_Status || rec.fields.Stage || "",
    location: rec.fields.Location || rec.fields["Company Location"] || "",
    sector: rec.fields.Sector || rec.fields.Industry || "",
    ev: rec.fields.EV || rec.fields["Enterprise Value"] || "",
    dscrBase: rec.fields.DSCR_Base || rec.fields["DSCR Base"] || "",
    dscrStress: rec.fields.DSCR_Stress || rec.fields["DSCR Stress"] || "",
    broker: rec.fields.Broker || "",
    lenderAssigned: rec.fields.Lender_Assigned || "",
    vendorNames: rec.fields.Vendor_Names || "",
    postCompletionRoles: rec.fields.Post_Completion_Roles || rec.fields["Post-Completion Roles"] || "",
    lenderExecutiveSummary: rec.fields.Lender_Executive_Summary || rec.fields["Lender Executive Summary"] || "",
    businessDescription: rec.fields.Business_Description || rec.fields["Business Description"] || "",
    investmentHighlights: rec.fields.Investment_Highlights || rec.fields["Investment Highlights"] || "",
    acquisitionRationale: rec.fields.Acquisition_Rationale || rec.fields["Acquisition Rationale"] || "",
    dealType: rec.fields.Deal_Type || rec.fields["Deal Type"] || "",
    turnover: rec.fields.Turnover || rec.fields.turnover || rec.fields.Revenue || rec.fields.revenue || "",
    ebitda: rec.fields.EBITDA || rec.fields.ebitda || rec.fields.EBITDA_GBP || rec.fields["EBITDA GBP"] || "",
    evAsk: rec.fields.Asking_Price_GBP || rec.fields["Asking Price"] || rec.fields.Asking_Price || rec.fields.evAsk || "",
    capitalStructure: buildCapitalStructure(rec.fields),
    rawFields: rec.fields,
    dealFiles: rec.fields["Deal Files"] || rec.fields.dealFiles || "",
    ndaApproved: rec.ndaApproved
  }));
}

export async function fetchLenderDocuments(portalSlug: string): Promise<DealDocument[]> {
  const response = await fetch("/api/lender/documents", {
    headers: getLenderHeaders(portalSlug)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load approved documents");
  }

  const rawDocs = await response.json();
  
  // Map raw fields to DealDocument format
  return rawDocs.map((rec: any) => ({
    id: rec.id,
    dealRef: Array.isArray(rec.fields.Deal_Ref) ? rec.fields.Deal_Ref[0] : (rec.fields.Deal_Ref || ""),
    documentName: rec.fields.Document_Name || rec.fields["Document Name"] || "",
    category: rec.fields.Category || "",
    ablCritical: Boolean(rec.fields.ABL_Critical || rec.fields["ABL Critical"]),
    status: rec.fields.Status || "",
    source: rec.fields.Source || "",
    dateReceived: rec.fields.Date_Received || rec.fields["Date Received"] || "",
    driveLink: Array.isArray(rec.fields.Drive_Link) ? rec.fields.Drive_Link[0] : (rec.fields.Drive_Link || rec.fields["drive link"] || ""),
    expectedDate: rec.fields.Expected_Date || "",
    internalNotes: "", // Purposely redacted on client
    dateSentToLender: rec.fields.Date_Sent_To_Lender || "",
    lenderTarget: "" // Purposely redacted on client
  }));
}

function buildCapitalStructure(fields: any) {
  const rows = [
    {
      label: "Senior Debt",
      provider: fields["Senior_Debt_Provider"] || fields["Senior Debt Provider"] || "",
      amount: fields["Senior_Debt"] || fields["Senior Debt"] || "",
      notes: fields["Senior_Debt_Notes"] || fields["Senior Debt Notes"] || ""
    },
    {
      label: "Subordinated Debt",
      provider: fields["Sub_Debt_Provider"] || fields["Sub Debt Provider"] || "",
      amount: fields["Sub_Debt"] || fields["Sub Debt"] || "",
      notes: fields["Sub_Debt_Notes"] || fields["Sub Debt Notes"] || ""
    },
    {
      label: "Equity",
      provider: fields["Equity_Provider"] || fields["Equity Provider"] || "",
      amount: fields["Equity"] || fields["Equity Amount"] || "",
      notes: fields["Equity_Notes"] || fields["Equity Notes"] || ""
    },
    {
      label: "Seller Note",
      provider: fields["Seller_Note_Provider"] || fields["Seller Note Provider"] || "",
      amount: fields["Seller_Note"] || fields["Seller Note"] || "",
      notes: fields["Seller_Note_Notes"] || fields["Seller Note Notes"] || ""
    }
  ];

  return rows.filter(row => row.provider || row.amount || row.notes);
}

export async function fetchLenderSubmissions(portalSlug: string): Promise<SubmissionLogEntry[]> {
  const response = await fetch("/api/lender/submissions", {
    headers: getLenderHeaders(portalSlug)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load activity logs");
  }

  return response.json();
}

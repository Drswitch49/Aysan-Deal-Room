import type { RawAirtableFields } from "./airtable";

export type PipelineDeal = {
  id: string;
  dealRef: string;
  companyName: string;
  status: string;
  location: string;
  sector: string;
  ev: string;
  dscrBase: string;
  dscrStress: string;
  broker: string;
  lenderAssigned: string;
  vendorNames: string;
  postCompletionRoles: string;
  capitalStructure: CapitalStructureRow[];
  rawFields: RawAirtableFields;
  dealFiles: string;
  ndaApproved?: boolean;

  // Enriched fields from server-side joins
  revenue?: string;
  ebitda?: string;
  evAsk?: string;
  multiplier?: string;
  ownerName?: string;
  ownerInitials?: string;
  nextActionTitle?: string;
  nextActionSub?: string;
  nextActionColor?: string;
  actionDate?: string;
  isBlocked?: boolean;
  blockerCount?: number;
  blockers?: string[];
  isProcessing?: boolean;
  processingStatusText?: string;
  stageAgeDays?: number;
};

export type CapitalStructureRow = {
  label: string;
  provider: string;
  amount: string;
  notes: string;
};

export type DealDocument = {
  id: string;
  dealRef: string;
  documentName: string;
  category: string;
  ablCritical: boolean;
  status: string;
  source: string;
  dateReceived: string;
  driveLink: string;
  expectedDate: string;
  internalNotes: string;
  dateSentToLender: string;
  lenderTarget: string;
};

export type SubmissionLogEntry = {
  id: string;
  dealRef: string;
  date: string;
  whatWasSent: string;
  sentTo: string;
  sentVia: string;
  responseReceived: string;
  flag: string;
};

export type ChatMessage = {
  id: string;
  dealId: string;
  lenderId: string;
  sender: string;
  message: string;
  timestamp: string;
};


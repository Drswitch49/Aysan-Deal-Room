// Deal entity types
export interface Deal {
  id: string;
  dealRef: string;
  companyName: string;
  projectName: string;
  industry: string;
  website?: string;
  location: string;
  owner: string;
  analyst: string;
  source: string;
  revenue?: number;
  ebitda?: number;
  enterpriseValue?: number;
  askingPrice?: number;
  stage: "Inbound" | "Seller Call" | "IM Review" | "Due Diligence" | "LOI" | "Under Offer" | "Closed" | "Archived";
  nextAction?: string;
  dueDate?: string;
  internalNotes?: string;
  imReviewDocuments?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDealInput {
  companyName: string;
  projectName: string;
  industry: string;
  website?: string;
  location: string;
  owner: string;
  analyst: string;
  source: string;
  revenue?: number;
  ebitda?: number;
  enterpriseValue?: number;
  askingPrice?: number;
  stage?: string;
  nextAction?: string;
  dueDate?: string;
  internalNotes?: string;
}

// Portfolio Company entity types
export interface PortfolioCompany {
  id: string;
  companyName: string;
  industry: string;
  revenue?: number;
  ebitda?: number;
  debt?: number;
  headcount?: number;
  status: "Active" | "In Transition" | "Exited" | "Archived";
  location: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePortfolioCompanyInput {
  companyName: string;
  industry: string;
  revenue?: number;
  ebitda?: number;
  debt?: number;
  headcount?: number;
  status: "Active" | "In Transition" | "Exited" | "Archived";
  location: string;
  notes?: string;
}

// Team Member entity types
export type UserRole = "Managing Partner" | "Partner" | "Analyst" | "Admin" | "Read Only";
export type UserStatus = "Active" | "Inactive";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamMemberInput {
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  status?: UserStatus;
}

// External Stakeholder entity types
export type StakeholderType = "Advisor" | "Lawyer" | "Broker" | "Consultant" | "Investor" | "Portfolio Contact";

export interface ExternalStakeholder {
  id: string;
  name: string;
  type: StakeholderType;
  email?: string;
  phone?: string;
  organization?: string;
  notes?: string;
  status: "Active" | "Archived";
  createdAt: string;
  updatedAt: string;
}

export interface CreateExternalStakeholderInput {
  name: string;
  type: StakeholderType;
  email?: string;
  phone?: string;
  organization?: string;
  notes?: string;
}

// IM Document entity types
export interface IMReviewDocument {
  id: string;
  documentName: string;
  fileType: "PDF" | "DOCX" | "XLSX";
  fileUrl: string;
  dealRef: string;
  uploadedBy: string;
  uploadedAt: string;
  fileSize: number;
}

// Stage History entity types
export interface DealStageHistory {
  id: string;
  dealRef: string;
  fromStage: string;
  toStage: string;
  changedBy: string;
  changedAt: string;
  notes?: string;
}

// Audit Log entity types
export type AuditEventType =
  | "CREATE_DEAL"
  | "UPDATE_DEAL"
  | "DELETE_DEAL"
  | "STAGE_CHANGED"
  | "IM_UPLOADED"
  | "IM_REMOVED"
  | "PORTCO_CREATED"
  | "PORTCO_UPDATED"
  | "PORTCO_ARCHIVED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DEACTIVATED"
  | "STAKEHOLDER_CREATED"
  | "STAKEHOLDER_UPDATED"
  | "STAKEHOLDER_ARCHIVED"
  | "PASSWORD_RESET"
  | "PERMISSION_CHANGED"
  | "SCHEMA_TABLE_CREATED"
  | "SCHEMA_FIELD_CREATED"
  | "SCHEMA_FIELD_UPDATED";

export interface AuditLog {
  id: string;
  eventType: AuditEventType;
  entityType: string;
  entityId: string;
  userId: string;
  action: string;
  changes?: string;
  timestamp: string;
  ipAddress?: string;
}

export interface CreateAuditLogInput {
  eventType: AuditEventType;
  entityType: string;
  entityId: string;
  userId: string;
  action: string;
  changes?: Record<string, any>;
  ipAddress?: string;
}

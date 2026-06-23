import { config } from "../config/env";
import type { DealDocument, PipelineDeal, SubmissionLogEntry } from "../types/deal";

const getAdminHeaders = () => {
  return {
    "Content-Type": "application/json"
  };
};

export function clearAirtableCache() {
  // Caching is now handled server-side at the CDN Edge and in-memory levels.
}

export async function getDeals(): Promise<PipelineDeal[]> {
  const response = await fetch("/api/deals");
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load active pipeline deals");
  }
  return response.json();
}

export async function getDealByRef(ref: string, forceRefresh: boolean = false): Promise<PipelineDeal | null> {
  const url = forceRefresh ? `/api/deals?ref=${encodeURIComponent(ref)}&forceRefresh=true` : `/api/deals?ref=${encodeURIComponent(ref)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load deal details for ref: ${ref}`);
  }
  return response.json();
}

export async function getAllDocuments(): Promise<DealDocument[]> {
  const response = await fetch("/api/deals?type=documents");
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load checklist documents");
  }
  return response.json();
}

export async function getDocumentsForDeal(ref: string): Promise<DealDocument[]> {
  const response = await fetch(`/api/deals?type=documents&ref=${encodeURIComponent(ref)}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load documents for deal: ${ref}`);
  }
  return response.json();
}

export async function getAllSubmissionLog(): Promise<SubmissionLogEntry[]> {
  const response = await fetch("/api/deals?type=submissions");
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load submission activities");
  }
  return response.json();
}

export async function getSubmissionLogForDeal(ref: string): Promise<SubmissionLogEntry[]> {
  const response = await fetch(`/api/deals?type=submissions&ref=${encodeURIComponent(ref)}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load activity logs for deal: ${ref}`);
  }
  return response.json();
}

export async function getDealByRefForLender(ref: string): Promise<PipelineDeal | null> {
  // Lenders resolve their deals securely through the proxy endpoint
  return getDealByRef(ref);
}

export async function getDocumentsForLender(ref: string): Promise<DealDocument[]> {
  const deal = await getDealByRefForLender(ref);
  if (!deal) return [];

  const allDocs = await getAllDocuments();
  return allDocs
    .filter(
      (doc) => 
        doc.dealRef.toLowerCase() === deal.id.toLowerCase() &&
        (doc.status || "").trim().toLowerCase() === "sent to lender"
    )
    .map((doc) => {
      if (!doc.driveLink && deal.dealFiles) {
        return { ...doc, driveLink: deal.dealFiles };
      }
      return doc;
    });
}

export async function getDealInbox(): Promise<any[]> {
  const response = await fetch("/api/deals?type=inbox", {
    headers: getAdminHeaders()
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load deal inbox records");
  }
  const data = await response.json();
  return data;
}

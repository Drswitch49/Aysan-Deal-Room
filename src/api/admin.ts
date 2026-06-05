import { config } from "../config/env";
import { clearAirtableCache } from "./airtable";

const getAdminHeaders = () => {
  const sessionPasscode = sessionStorage.getItem("admin_passcode");
  const adminPasscode = sessionPasscode || config.lenderRoomPassword || "acp-deal-room";
  return {
    "Content-Type": "application/json",
    "x-admin-passcode": adminPasscode
  };
};

export async function fetchAdminLenders() {
  const response = await fetch("/api/admin/lenders", {
    headers: getAdminHeaders()
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load lenders list");
  }

  return response.json();
}

export async function createLender(data: {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  status: string;
}) {
  const response = await fetch("/api/lender/create", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to create lender");
  }

  clearAirtableCache();
  return response.json();
}

export async function assignDealToLender(lenderRecordId: string, dealRef: string, ndaApproved?: boolean) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "assign-deal", lenderRecordId, dealRef, ndaApproved })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to assign deal");
  }

  clearAirtableCache();
  return response.json();
}

export async function removeDealAssignment(assignmentId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "remove-deal", assignmentId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to remove assignment");
  }

  clearAirtableCache();
  return response.json();
}

export async function toggleLenderNda(lenderId: string, ndaApproved: boolean) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "update-lender-nda", lenderId, ndaApproved })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to update lender NDA status");
  }

  clearAirtableCache();
  return response.json();
}

export async function resetLenderPassword(lenderRecordId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "reset-password", lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to reset password");
  }

  clearAirtableCache();
  return response.json();
}

export async function regenerateLenderPortal(lenderRecordId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "regenerate-portal", lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to regenerate portal link");
  }

  clearAirtableCache();
  return response.json();
}

export async function deleteLender(lenderRecordId: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "delete-lender", lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to delete lender");
  }

  clearAirtableCache();
  return response.json();
}

export async function updateAdminDocuments(updates: Array<{ id: string; fields: Record<string, any> }>) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "update-documents", updates })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to update documents");
  }

  clearAirtableCache();
  return response.json();
}

export async function createAdminDocument(data: {
  documentName: string;
  category: string;
  status: string;
  driveLink?: string;
  dealId: string;
  ablCritical?: boolean;
}) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "create-document", ...data })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to create document");
  }

  clearAirtableCache();
  return response.json();
}

export async function changeAdminPassword(newPassword: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "change-admin-password", newPassword })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to update admin passcode");
  }

  return response.json();
}

export async function resetAdminPassword(masterPasscode: string, newPassword: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-passcode": masterPasscode
    },
    body: JSON.stringify({ action: "change-admin-password", newPassword })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to reset admin passcode");
  }

  return response.json();
}

export async function createAdminDeal(data: {
  dealName: string;
  acpRefNo?: string;
  stage?: string;
  nextAction?: string;
  nextActionDate?: string;
}) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "create-deal", ...data })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to create deal");
  }

  clearAirtableCache();
  return response.json();
}




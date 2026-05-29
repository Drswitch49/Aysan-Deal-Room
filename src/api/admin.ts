import { config } from "../config/env";

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

  return response.json();
}

export async function assignDealToLender(lenderRecordId: string, dealRef: string) {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "assign-deal", lenderRecordId, dealRef })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to assign deal");
  }

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




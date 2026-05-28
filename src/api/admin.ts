import { config } from "../config/env";

const getAdminHeaders = () => {
  const adminPasscode = config.lenderRoomPassword || "acp-deal-room";
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
  const response = await fetch("/api/admin/assign-deal", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ lenderRecordId, dealRef })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to assign deal");
  }

  return response.json();
}

export async function removeDealAssignment(assignmentId: string) {
  const response = await fetch("/api/admin/remove-deal", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ assignmentId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to remove assignment");
  }

  return response.json();
}

export async function resetLenderPassword(lenderRecordId: string) {
  const response = await fetch("/api/admin/reset-password", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to reset password");
  }

  return response.json();
}

export async function regenerateLenderPortal(lenderRecordId: string) {
  const response = await fetch("/api/admin/regenerate-portal", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to regenerate portal link");
  }

  return response.json();
}

export async function deleteLender(lenderRecordId: string) {
  const response = await fetch("/api/admin/delete-lender", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to delete lender");
  }

  return response.json();
}

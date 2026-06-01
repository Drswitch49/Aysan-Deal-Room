import { config } from "../config/env";
import type { ChatMessage } from "../types/deal";

// Helper to retrieve lender headers from sessionStorage
const getLenderHeaders = (portalSlug: string): Record<string, string> => {
  const sessionStr = sessionStorage.getItem(`lender_session_${portalSlug}`);
  if (!sessionStr) return {};
  try {
    const session = JSON.parse(sessionStr);
    return {
      "Content-Type": "application/json",
      "x-lender-slug": portalSlug,
      "x-lender-password": session.password || ""
    };
  } catch {
    return {
      "Content-Type": "application/json"
    };
  }
};

// Helper to retrieve admin headers from sessionStorage
const getAdminHeaders = () => {
  const sessionPasscode = sessionStorage.getItem("admin_passcode");
  const adminPasscode = sessionPasscode || config.lenderRoomPassword || "acp-deal-room";
  return {
    "Content-Type": "application/json",
    "x-admin-passcode": adminPasscode
  };
};

/**
 * Fetch chat messages for a specific deal in the lender portal
 */
export async function fetchLenderChat(portalSlug: string, dealId: string): Promise<ChatMessage[]> {
  const response = await fetch(`/api/lender/chat?dealId=${encodeURIComponent(dealId)}`, {
    headers: getLenderHeaders(portalSlug)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load chat history");
  }

  return response.json();
}

/**
 * Send a chat message from a lender in the lender portal
 */
export async function sendLenderChatMessage(
  portalSlug: string,
  dealId: string,
  message: string
): Promise<ChatMessage> {
  const response = await fetch("/api/lender/chat", {
    method: "POST",
    headers: getLenderHeaders(portalSlug),
    body: JSON.stringify({ dealId, message })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to send message");
  }

  return response.json();
}

/**
 * Fetch chat messages for a specific lender-deal thread in the admin panel
 */
export async function fetchAdminChat(dealId: string, lenderRecordId: string): Promise<ChatMessage[]> {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "get-chat", dealId, lenderRecordId })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load chat history");
  }

  const data = await response.json();
  return data.results || [];
}

/**
 * Send a chat message from the admin to a specific lender in the admin panel
 */
export async function sendAdminChatMessage(
  dealId: string,
  lenderRecordId: string,
  message: string
): Promise<ChatMessage> {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "send-chat", dealId, lenderRecordId, message })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to send message");
  }

  const data = await response.json();
  return data.result;
}

/**
 * Fetch all recent chat messages across deals for a lender
 */
export async function fetchRecentLenderChat(portalSlug: string): Promise<ChatMessage[]> {
  const response = await fetch(`/api/lender/chat`, {
    headers: getLenderHeaders(portalSlug)
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load recent messages");
  }

  return response.json();
}

/**
 * Fetch all recent chat messages across all deals/lenders for the admin
 */
export async function fetchRecentAdminChat(): Promise<ChatMessage[]> {
  const response = await fetch("/api/admin/action", {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ action: "get-recent-messages" })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to load recent messages");
  }

  const data = await response.json();
  return data.results || [];
}

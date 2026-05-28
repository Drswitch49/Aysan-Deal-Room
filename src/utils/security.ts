import type { CapitalStructureRow } from "../types/deal";

export const SENT_TO_LENDER_STATUS = "Sent to Lender";

export function isSentToLender(status: string): boolean {
  return status.trim().toLowerCase() === SENT_TO_LENDER_STATUS.toLowerCase();
}

export function redactCapitalStructureForLender(rows: CapitalStructureRow[]): CapitalStructureRow[] {
  return rows.map((row) => ({
    ...row,
    provider: row.provider ? "ACP Arranged" : "",
    notes: "",
  }));
}

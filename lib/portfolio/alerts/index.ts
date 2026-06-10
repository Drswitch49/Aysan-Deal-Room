import type { PortfolioAlertRecord } from "../db.js";

/**
 * Filter alerts to return only active (non-resolved) ones.
 */
export function getActiveAlerts(alerts: PortfolioAlertRecord[]): PortfolioAlertRecord[] {
  return alerts.filter((a) => !a.resolvedAt);
}

/**
 * Filter active alerts that are classified as critical severity.
 */
export function getCriticalAlerts(alerts: PortfolioAlertRecord[]): PortfolioAlertRecord[] {
  return alerts.filter((a) => a.severity === "critical" && !a.resolvedAt);
}

/**
 * Filter active alerts that are classified as medium severity.
 */
export function getMediumAlerts(alerts: PortfolioAlertRecord[]): PortfolioAlertRecord[] {
  return alerts.filter((a) => a.severity === "medium" && !a.resolvedAt);
}

/**
 * Categorize a list of alerts by their alert type.
 */
export function groupAlertsByType(
  alerts: PortfolioAlertRecord[]
): Record<string, PortfolioAlertRecord[]> {
  const groups: Record<string, PortfolioAlertRecord[]> = {
    financial: [],
    operational: [],
    reporting: [],
    osint: [],
    workflow: [],
  };

  for (const a of alerts) {
    if (groups[a.alertType]) {
      groups[a.alertType].push(a);
    }
  }

  return groups;
}

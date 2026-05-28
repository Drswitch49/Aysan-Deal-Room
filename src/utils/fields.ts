import type { AirtableFieldValue, RawAirtableFields } from "../types/airtable";

export function firstField(fields: RawAirtableFields, names: string[]): AirtableFieldValue {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return "";
}

export function asText(value: AirtableFieldValue): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" || typeof item === "number") return String(item);
        if (item && typeof item === "object") return item.filename ?? item.url ?? item.id ?? "";
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") return value.filename ?? value.url ?? value.id ?? "";

  return "";
}

export function asUrl(value: AirtableFieldValue): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const firstUrl = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return item.url ?? "";
        return "";
      })
      .find(Boolean);
    return firstUrl ?? "";
  }
  if (typeof value === "object") return value.url ?? "";

  return "";
}

export function asBoolean(value: AirtableFieldValue): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    return ["true", "yes", "y", "1", "critical"].includes(value.trim().toLowerCase());
  }

  return false;
}

export function formatDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function daysSince(value: string): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  const diff = today.getTime() - date.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

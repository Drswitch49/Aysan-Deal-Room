export function escapeFormulaString(value: any): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  // Match single quotes and backslashes, escape them appropriately for Airtable
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'");
}

/**
 * Builds an OR formula for matching a field against multiple possible values.
 */
export function buildOrFormula(fieldName: string, values: string[]): string {
  const conditions = values
    .filter(Boolean)
    .map((val) => `{${fieldName}} = '${escapeFormulaString(val)}'`);
  
  if (conditions.length === 0) return "";
  if (conditions.length === 1) return conditions[0];
  return `OR(${conditions.join(", ")})`;
}

/**
 * Combines multiple conditions into an AND formula.
 */
export function buildAndFormula(conditions: string[]): string {
  const active = conditions.filter(Boolean);
  if (active.length === 0) return "";
  if (active.length === 1) return active[0];
  return `AND(${active.join(", ")})`;
}

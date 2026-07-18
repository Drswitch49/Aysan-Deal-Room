/**
 * Admin client (Phase 6 — Supabase-backed REST) — barrel.
 *
 * Full rewrite of the legacy module that funneled 35 actions through the
 * /api/admin/action god-endpoint. Every export keeps its signature so pages
 * keep compiling; internally everything now hits the rebuilt REST API.
 * Lender/HR objects keep their legacy Airtable-style keys (Company_Name, …)
 * until the pages are decomposed.
 *
 * The monolith was split into domain modules; import from "../api/admin" as
 * before — this barrel re-exports the full surface.
 */
export * from "./lenders";
export * from "./deals";
export * from "./documents";
export * from "./hr";
export * from "./ai";
export * from "./portfolio";
export * from "./settings";

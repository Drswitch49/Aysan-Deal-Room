# ACP Deal Room

Full-stack deal-room platform for Aysan Capital Partners: deal pipeline +
kanban, document checklist, lender & shareholder portals, AI analysis
(verdicts, transcripts, pre/post-call briefs, OSINT), portfolio monitoring,
and HR/stakeholder registries.

## Stack

- **Frontend:** React 19 + Vite + TypeScript + TailwindCSS (SPA, React Router)
- **API:** Vercel serverless functions (`api/`), typed handler pipeline
  (`api/_lib/handler.ts`: method → zod validation → auth → RBAC → service)
- **Database:** Supabase Postgres — schema in `supabase/migrations/`
  (apply with `npm run db:migrate`)
- **Auth:** Supabase Auth (staff, lenders, shareholders) with httpOnly session
  cookies; per-handler default-deny authorization (`api/_lib/authz.ts`)
- **Files:** Cloudinary (authenticated assets; browser uploads via
  server-signed payloads; server reads via API-key-signed download URLs)
- **Background jobs:** self-hosted queue (`jobs` table + `lib/jobs`), worker at
  `/api/jobs/worker` driven by Vercel Cron
- **AI:** Anthropic Claude via `@anthropic-ai/sdk` (`lib/ai`), zod-validated
  outputs with repair retry

## Development

```sh
npm install
npm run dev        # frontend + API on one port (vite plugin emulates Vercel routes)
npm run typecheck
npm run test       # vitest (incl. financial-engine golden numbers)
npm run build
```

## Environment

See `.env` locally (never committed). Required groups:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
  `SUPABASE_DB_URL` (session-pooler URI; migrations only)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `ANTHROPIC_API_KEY`
- `CRON_SECRET` (Vercel Cron → job worker auth)
- Optional integrations: `NEWS_API_KEY`, `COMPANIES_HOUSE_API_KEY`

## Architecture notes

- All data access goes through typed repositories (`lib/data/supabase`) —
  no handler or component talks to the database directly.
- Zod schemas in `lib/core/schemas` are the single source of type truth.
- Legacy-endpoint → REST mapping from the 2026 rewrite: `docs/api-migration-map.md`.
- The one-time Airtable→Supabase ETL lives in `scripts/etl/` (historical;
  Airtable is no longer used at runtime).

## Deployment (Vercel)

1. Set the environment variables above in Vercel.
2. Default Vite settings — build `npm run build`, output `dist/`.
3. `vercel.json` configures the SPA rewrite, the job worker's `maxDuration`,
   and the every-minute cron for `/api/jobs/worker`.

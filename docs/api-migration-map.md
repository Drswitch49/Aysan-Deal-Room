# API migration map — legacy → rebuilt (Supabase)

Reference for the Phase 6 frontend repoint. The legacy Airtable-backed endpoints
(`api/admin/action.ts` god-endpoint + `*-crud.ts` files) are replaced by RESTful
routes built on `api/_lib/handler.ts` + `lib/data` repositories.

## Legacy flat routes (deleted)

| Legacy route | Replacement |
|---|---|
| `api/deals.ts`, `api/deals-crud.ts` | `GET/POST /api/deals`, `GET/PATCH/DELETE /api/deals/:id`, `GET /api/deals/stats` |
| `api/deals-stages.ts` | `POST /api/deal-transitions` |
| `api/chats.ts` | `GET/POST /api/chats` (`?deal_id=`) |
| `api/lenders.ts` | `GET/POST /api/lenders`, `/api/lenders/:id` |
| `api/audit-logs.ts` | `GET /api/audit-logs` (admins) |
| `api/notes-crud.ts` | `/api/deal-notes`, `/api/deal-notes/:id` |
| `api/im-documents-crud.ts` | `/api/im-documents`, `/api/im-documents/:id` |
| `api/portfolio-companies-crud.ts` | `/api/portfolio-companies`, `/:id` |
| `api/shareholders-crud.ts` | `/api/shareholders`, `/:id` |
| `api/stakeholders-crud.ts` | `/api/stakeholders`, `/:id` |
| `api/team-members-crud.ts` | `/api/team-members`, `/:id` |

Temporary aliases keeping old URLs alive until the frontend repoint:
`/api/admin/lenders` → new lenders handler; `/api/lender/chat` → new chats handler.

## God-endpoint cases (`POST /api/admin/action`, 46 cases)

### Replaced by REST routes (available now)
| Action case | Replacement |
|---|---|
| `create-deal`, `update-deal`, `delete-deal`, `delete-inbox-deal`, `update-inbox-status` | `/api/deals`, `/api/deals/:id` (stage is a column; no cross-table copies) |
| `promote-deal`, `remove-deal` | `POST /api/deal-transitions` (same-row stage transition + ACP ref + history + audit) |
| `assign-deal` | `POST /api/deal-assignments`, `DELETE /api/deal-assignments/:id` |
| `update-lender-nda`, `delete-lender` | `PATCH/DELETE /api/lenders/:id` |
| `create-document`, `update-documents`, `delete-document` | `/api/documents`, `/api/documents/:id` |
| `upload-temp-file`, `upload-im-document`, `remove-im-document`, `replace-im-document` | `POST /api/documents/sign-upload` (browser→Cloudinary direct) + `/api/im-documents` |
| `create/update/archive-portfolio-company` | `/api/portfolio-companies`, `/:id` |
| `create/update-team-member` | `/api/team-members`, `/:id` |
| `create/update-stakeholder` | `/api/stakeholders`, `/:id` |
| `add-hiring-brief`, `delete-hiring-brief` | `/api/hiring-briefs`, `/:id` |
| `get-chat`, `send-chat`, `get-recent-messages` | `/api/chats` |

### Deferred to Phase 4 (die with Supabase Auth)
`reset-password`, `get-lender-passcode`, `regenerate-portal`, `change-admin-password`
— legacy portal credentials are replaced by Supabase Auth accounts (invite/magic-link).

### Deferred to Phase 5 (job system + AI/OSINT/financial redesign)
`generate-verdict`, `trigger-osint`, `trigger-financial` — become enqueued jobs.
`send-loi`, `send-email`, `verify-integration` — integrations service.

### Obsolete (no replacement needed)
Runtime schema migration (`ensureTable` / `ensurePipelineFields` calls inside
action.ts) — schema now lives in checked-in SQL migrations (`supabase/migrations/`).

`api/admin/action.ts` itself is deleted in Phase 6 once the frontend calls the
routes above.

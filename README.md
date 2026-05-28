# ACP Deal Room V1

Lightweight operational deal-room interface for Aysan Capital Partners.

This app is a read-only React/Vite display layer over Airtable. It does not run a backend, write deal data, upload files, send email, authenticate users, or persist frontend state.

## Stack

- React + Vite + TypeScript
- TailwindCSS
- React Router
- Airtable REST API
- Google Drive links rendered from Airtable
- Vercel hosting

## Airtable Tables

The app expects these read-only tables and field names:

- `Active Pipeline`
- `Documents`
- `Submission_Log`

`Documents` fields:

- `Deal_Ref`
- `Document_Name`
- `Category`
- `ABL_Critical`
- `Status`
- `Source`
- `Date_Received`
- `Drive_Link`
- `Expected_Date`
- `Internal_Notes`
- `Date_Sent_To_Lender`
- `Lender_Target`

`Submission_Log` fields:

- `Deal_Ref`
- `Date`
- `What_Was_Sent`
- `Sent_To`
- `Sent_Via`
- `Response_Received`
- `Flag`

## Environment Variables

Create `.env.local` from `.env.example`:

```bash
VITE_AIRTABLE_API_KEY=
VITE_AIRTABLE_BASE_ID=
VITE_AIRTABLE_PIPELINE_TABLE=Active Pipeline
VITE_AIRTABLE_DOCUMENTS_TABLE=Documents
VITE_AIRTABLE_SUBMISSION_TABLE=Submission_Log
VITE_LENDER_ROOM_PASSWORD=
```

Use an Airtable personal access token scoped as narrowly as possible for read-only access to the required base.

`VITE_LENDER_ROOM_PASSWORD` is a lightweight JavaScript gate for `/lender/:ref`. It is not a replacement for Drive permissions or Airtable token scoping.

## Local Development

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

If you are using the project-local portable Node.js setup, use:

```powershell
.\npm-local.cmd install
.\npm-local.cmd run dev
```

## Build

```bash
npm run build
```

## Routes

- `/deals` - internal deal list
- `/deals/:ref` - internal deal detail with Cover Sheet, Document Checklist, and Submission Log tabs
- `/lender/:ref` - password-gated lender view

## Data Rules

- Airtable is the single source of truth.
- The frontend reads Airtable and renders Google Drive links.
- The frontend does not write Airtable data.
- The frontend does not upload files.
- The frontend does not store duplicate data locally.
- Make.com is assumed to handle Drive monitoring, permissions, and Airtable record creation.

## Lender Filtering

The lender page only displays documents where:

```text
Status == "Sent to Lender"
```

Internal notes, submission logs, lender strategy, other lenders, and in-review or rejected documents are not rendered in the lender UI.

If a capital structure provider is present in lender view, the provider is displayed as `ACP Arranged`.

## Vercel Deployment

1. Push this project to the repository connected to Vercel.
2. In Vercel, set the environment variables listed above.
3. Use the default Vite settings:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Deploy.

Because this is a static frontend, Airtable and Google Drive permissions must be configured outside the app.

# Synora

*Enterprise intelligence, connected.* One permission-aware search across tickets, documents, email and work items, for every department (IT, development, HR, finance, retail…). Answers cite their sources, and Synora says so when the evidence isn't good enough.

## Run it

- **Desktop:** double-click **Start Synora** / **Stop Synora** (copies in `scripts\windows\`). Start runs Docker, the database, the web app (http://localhost:3020) and the sync worker. Stop keeps all data.
- **By hand:**
  ```powershell
  npm install
  copy .env.example .env
  npm run db:up
  npm run setup        # tables, indexes, demo people and data (first run downloads the ~120 MB embedding model)
  npm run dev          # web app on :3020
  npm run worker       # sync worker, in a second terminal
  ```
- **Checks:** `npm run typecheck`, `npm run lint` and `npm test`.

In local development, sign-in uses fictional demo people, each in different departments. Production uses Microsoft Entra ID (`AUTH_PROVIDER=entra`) with these app roles:
- `role.<role>` (e.g. `role.support-engineer`)
- `space.<space>.<member|editor|owner>` (e.g. `space.hr.member`)

## How it works

```
Connector → ingest (change check, chunks, local embeddings, permissions) → Postgres + pgvector
Question → hybrid search (vector + keyword, permission filter in SQL) → evidence check → answer → citation check → stream
```

- **Spaces:** a space is a department. Each record stores who may see it (`acl`: space, source group or user). Search filters on that inside the SQL query, so the model never sees a record the person can't open.
- **Restricted records:** HR cases are restricted to their HDA owner group, even inside the HR space. Sensitive HDA ticket types (security incidents, report leaks, IP violations…) are never indexed. See `config/hda-mapping.json`.
- **No answer without evidence:** when there isn't enough authorized evidence, no AI is called and the person is told so.
- **Citations are enforced:** citations that weren't in the evidence are dropped. A sentence left without a citation is removed.
- **Calculated confidence:** confidence comes from the evidence: how many supporting records there are, approved knowledge, a confirmed root cause, past fixes that were only temporary, and age. The model doesn't set it.
- **AI provider:** `AI_PROVIDER=mock` writes answers by extracting from the evidence, with no AI involved. `openai` uses Codex through the EssilorLuxottica APIM gateway, ported from EL Knowledge Studio: strict JSON schema, `store:false`, and allow-listed hosts only. It stays off until `AI_DATA_PROCESSING_APPROVAL_REF` is set.
- **Embeddings:** `multilingual-e5-small` runs on the server, so indexing sends no content outside.

## Connectors

| Connector | Status |
|---|---|
| Demonstration data | Built. Prototype records plus HR, Finance and Development examples. |
| HDA Ticketing | Built (LoginEx, Projection, lockout protection). Indexes the solved and closed tickets of the **owner groups you activate**, incrementally by the solved date (C70C), with about 110 mapped HDA fields (`config/hda-mapping.json`). Re-reads text that HDA cut short, maps ticket types to spaces, and syncs the members of the active groups. |
| Azure DevOps | Built. Indexes every work item of one project (`ADO_PROJECT`) with all its fields and comments, plus the project wikis, into the Development space. Work items are incremental by changed date; new wiki pages are read at the next sync and known pages re-checked about once a day. Mapping in `config/ado-mapping.json`. |
| SharePoint & OneDrive | Built. One source for both: reads the folders you choose (and everything below them) in SharePoint sites and your OneDrive, as the Microsoft 365 account that signs in. Word, Excel and PowerPoint (old and new formats), PDF, Markdown, text, HTML, images (text recognition on the server) and draw.io diagrams. Settings in `config/m365-mapping.json`. |
| Outlook, Teams, Confluence, CSV, MCP | Next phases. They implement `src/lib/connectors/types.ts`. |

To switch on HDA:
1. Set `HDA_USERNAME` and `HDA_PASSWORD` in `.env`.
2. Connect to the VPN.
3. Run `npm run hda:discover` (optionally `-- --group G815L`) to check the field mapping against HDA.
4. On the Sources page, open **Owner groups** on the HDA card, search for the groups whose tickets Synora should index and activate them. Deactivating a group removes its tickets from Synora.
5. Click **Test connection**, then **Sync**.

To switch on Azure DevOps:
1. Create a personal access token with only the **Work Items (Read)** and **Wiki (Read)** scopes. Set `ADO_PAT` in `.env` and check `ADO_ORG_URL` and `ADO_PROJECT`. For production, use `ADO_AUTH_MODE=entra` with a service principal (`ADO_TENANT_ID`, `ADO_CLIENT_ID`, `ADO_CLIENT_SECRET`) added to the organization.
2. Restart the web app and the worker. On the Sources page, choose **Connect a source → Azure DevOps → Add Azure DevOps**.
3. Click **Test connection**, then **Sync**.

Work items get the reference `WI-<id>`. Parent, related and duplicate links, `#<id>` mentions and HDA ticket numbers become record links, so an HDA incident and the bug that fixed it show up together. Wiki pages are development documentation in answers; list paths in `wiki.approvedPaths` (for example `"/Runbooks"`) to make those pages count as approved knowledge. People (assigned to, created by…) are shown by name in the record panel only, never in the searchable text or the AI's evidence.

Load on Azure DevOps: per sync, one fields call, one recycle-bin call, then one WIQL and one batch call per 200 changed work items, plus one comments call per changed work item that has comments, and one page-tree call per wiki plus one read per new page and up to 100 re-checks of known pages (each page about once a day). Requests go one at a time, at least `requestDelayMs` (200 ms) apart, and Azure DevOps' `Retry-After` / `X-RateLimit-Delay` hints are obeyed.

### SharePoint & OneDrive

**What to ask IT for** (one app registration in the EssilorLuxottica Entra tenant):
- Name: Synora. Supported account types: this organization only.
- Platform **Web**, redirect URI `http://localhost:3020/api/connectors/m365/callback` (add the production address later, `https://<synora host>/api/connectors/m365/callback`).
- Microsoft Graph **delegated** permissions: `User.Read`, `offline_access`, `openid`, `profile`, `Files.Read.All`, `Sites.Read.All`, with admin consent if the tenant doesn't let users consent. No application permissions: Synora only ever reads what the signed-in person can open.
- A client secret. Send back the tenant ID, client ID and secret.

Then:
1. Set `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET` and `M365_SITE_URL` in `.env`, and restart the web app and the worker.
2. Sources → **Connect a source → SharePoint** (or OneDrive) → **Add SharePoint & OneDrive**.
3. On its card, **Sign in to Microsoft 365**, then **Folders**: open the site's libraries or your OneDrive, choose folders, and tick **Approved knowledge** for folders whose documents are reviewed guidance. Everything else counts as a reference document in answers.

How it works: the refresh token is stored encrypted (AES-256-GCM, key from `CREDENTIAL_ENCRYPTION_KEY` or `SESSION_SECRET`) in the database and is never sent to the browser. Each sync (every 6 hours) lists the chosen folders and reads only files whose change tag changed; deleted or moved files leave Synora, and removing a folder removes its documents. Office files are converted to PDF by Microsoft 365 (`?format=pdf`) and their text read; images go through text recognition on the Synora server (`OCR_LANGUAGES`, language data cached in `.models/`), so pictures never leave it. Files over 50 MB (images over 15 MB) are skipped and noted in the sync history. People (created/modified by) appear in the record panel only.

### HDA field mapping and load

- `columns` in `config/hda-mapping.json` are the core fields; `fields` is the extended mapping. `search` fields join the searchable text, `detail` fields are shown in the record panel, and `person` fields (names) are never searchable or sent to the AI. Fields of ticket types that are never indexed (security incidents, IP violations, report leaks, product quality) are left out on purpose.
- Linked records are read by name (`Service.Description`). If HDA rejects an expression, the sync uses its `fallback` (the raw id) or skips it and logs it, so one wrong name can't stop a sync.
- Load on HDA: searching never calls HDA. A sync sends one request at a time, at least `requestDelayMs` (300 ms) apart. Each page of 200 tickets takes about 5 Projection calls (columns are split to keep every URL under `maxUrlLength`), plus one `/WSC/Get` per ticket whose text HDA cut short. Pages are read by solved date, not by offset, so deep pages cost HDA no more than the first. Group members are re-read once a day. After a failed sync, the next attempt waits for the normal schedule.

## Layout

- `prisma/schema.prisma`: data model. `scripts/db-indexes.ts` adds the indexes Prisma can't express: HNSW, GIN and trigram.
- `src/lib/search/`: query parsing, hybrid retrieval, answer checks, streaming pipeline.
- `src/lib/connectors/`: SDK, registry, sync runner, demo and HDA connectors.
- `src/lib/ingest/`: chunking, hashing, embeddings, permissions, links.
- `src/worker/`: job queue worker (Postgres `FOR UPDATE SKIP LOCKED`).
- `src/app/`: pages and API routes. `src/components/`: UI ported from `prototype/`.
- `prototype/`: the clickable prototype published as a Claude artifact.

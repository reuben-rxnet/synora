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
| HDA Ticketing | Built, using the CSAT Pulse HDA client (LoginEx, Projection, lockout protection). Indexes solved and closed tickets incrementally by the solved date (C70C), re-reads text that HDA cut short, maps ticket types to spaces, and syncs owner-group membership. |
| Azure DevOps, SharePoint, Outlook, Teams, OneDrive, Confluence, CSV, MCP | Next phases. They implement `src/lib/connectors/types.ts`. |

To switch on HDA:
1. Set `HDA_USERNAME` and `HDA_PASSWORD` in `.env`.
2. Connect to the VPN.
3. Run `npm run hda:discover`.
4. On the Sources page, click **Test connection**, then **Sync**.

## Layout

- `prisma/schema.prisma`: data model. `scripts/db-indexes.ts` adds the indexes Prisma can't express: HNSW, GIN and trigram.
- `src/lib/search/`: query parsing, hybrid retrieval, answer checks, streaming pipeline.
- `src/lib/connectors/`: SDK, registry, sync runner, demo and HDA connectors.
- `src/lib/ingest/`: chunking, hashing, embeddings, permissions, links.
- `src/worker/`: job queue worker (Postgres `FOR UPDATE SKIP LOCKED`).
- `src/app/`: pages and API routes. `src/components/`: UI ported from `prototype/`.
- `prototype/`: the clickable prototype published as a Claude artifact.

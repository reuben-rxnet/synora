import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePageSession } from "@/lib/auth/session";
import { activeProvider } from "@/lib/search/answer";
import { Badge, Icon, KindBadge, StatusPill } from "@/components/ui";
import pkg from "../../../../package.json";

export const metadata: Metadata = { title: "About" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  ["overview", "Overview"], ["features", "Features"], ["sources", "Connected sources"], ["answers", "How answers work"],
  ["guides", "Help guides"], ["admin", "For administrators"], ["troubleshooting", "Troubleshooting"],
  ["privacy", "Privacy & security"], ["stack", "Tech stack"], ["glossary", "Glossary"],
] as const;

const FEATURES: [string, string, string][] = [
  ["sparkles", "Ask Synora", "Describe an issue in your own words. Synora finds the evidence you're allowed to see and writes an answer in which every sentence cites its source."],
  ["search", "Search records", "Keyword and meaning-based search across tickets, work items, wiki pages and documents, with filters for source, record type, evidence and date."],
  ["similar", "Find similar issues", "Paste an incident and compare it with historical ones: what was the cause then, what fixed it, and whether the fix was only temporary."],
  ["zap", "Investigate incident", "A deeper answer mode that lists possible causes as hypotheses, each marked as supported or only possible by the evidence."],
  ["link", "Linked evidence", "HDA ticket numbers in Azure DevOps items, #work-item mentions in wikis and documents, and parent/duplicate links connect related records."],
  ["bookmark", "Saved & pinned", "Keep searches and records you come back to, and organize them in collections."],
  ["chart", "Analytics", "Knowledge coverage and search quality, counted only over the records you can access."],
  ["plug", "Sources", "Connectors for HDA, Azure DevOps (work items and wikis) and SharePoint & OneDrive, synced in the background."],
  ["shield", "Permission-aware", "Every record keeps who may see it. Search filters on that inside the database, so neither you nor the AI ever see a record you couldn't open."],
];

const STACK: [string, string, string | null][] = [
  ["Web app", "Next.js (App Router) and React, written in TypeScript", "next"],
  ["UI", "Hand-built components with Tailwind CSS and design tokens; light and dark themes", "tailwindcss"],
  ["Database", "PostgreSQL with pgvector (HNSW vector index, GIN and trigram text indexes), run in Docker", null],
  ["Data access", "Prisma ORM; raw SQL for hybrid retrieval and permission filters", "@prisma/client"],
  ["Embeddings", "multilingual-e5-small, run on the Synora server with Transformers.js, so indexing sends no content out", "@huggingface/transformers"],
  ["AI answers", "OpenAI models through the EssilorLuxottica APIM gateway (Responses API, strict JSON schema, store:false)", null],
  ["Sign-in", "Microsoft Entra ID (OpenID Connect with PKCE); demo people for local development", "openid-client"],
  ["Validation", "zod schemas on every API input and on the model's output", "zod"],
  ["Background sync", "A worker process with a Postgres job queue (FOR UPDATE SKIP LOCKED, leases with heartbeats)", "tsx"],
  ["Documents", "PDF text with unpdf (pdf.js); Office files converted to PDF by Microsoft 365", "unpdf"],
  ["Images", "Text recognition with Tesseract on the server", "tesseract.js"],
  ["Source APIs", "HDA REST (WSC), Azure DevOps REST (WIQL, work items, comments, wiki), Microsoft Graph (SharePoint, OneDrive)", null],
  ["Quality", "Vitest unit tests, ESLint, strict TypeScript", "vitest"],
];

const GLOSSARY: [string, string][] = [
  ["Space", "A department area (IT Support, Development, Retail…). Everyone can search non-restricted spaces; restricted ones (HR) need a membership."],
  ["Source / connector", "A connected system Synora copies records from, such as HDA or SharePoint."],
  ["Evidence", "The records an answer is built from. Only evidence you may open is used."],
  ["Citation", "The reference after a sentence that opens the record it came from. Sentences without a valid citation are removed."],
  ["Confidence", "Calculated from the evidence (how many records agree, approved knowledge, confirmed root causes, age), never chosen by the AI."],
  ["Owner group", "The HDA group that owns a ticket. Only tickets of the owner groups activated on the Sources page are indexed."],
  ["Sync", "A background run that reads what changed in a source since the last run."],
];

function Guide({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="about-guide"><summary>{title}</summary><div className="about-guide-body">{children}</div></details>;
}

export default async function AboutPage() {
  const s = await requirePageSession();
  const [connectors, visible] = await Promise.all([
    db.connector.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, type: true, status: true, recordCount: true, lastSyncAt: true, space: { select: { name: true } } } }),
    db.sourceRecord.count({ where: { deletedAt: null, acl: { hasSome: s.principals } } }),
  ]);
  const ai = activeProvider();
  const deps = pkg.dependencies as Record<string, string>;
  const dev = pkg.devDependencies as Record<string, string>;
  const version = (name: string | null) => (name ? (deps[name] ?? dev[name] ?? "").replace(/^[\^~]/, "") : "");
  const isAdmin = s.permissions.has("connectors.manage");

  return (
    <div className="page about">
      <header className="page-head">
        <div>
          <h1>About Synora</h1>
          <p className="muted">{pkg.description} Version {pkg.version}.</p>
        </div>
        <div className="row-wrap tight">
          <Badge tone="neutral" icon="database">{visible.toLocaleString("en-GB")} records you can search</Badge>
          <Badge tone={ai.provider === "openai" ? "good" : "warn"} icon="sparkles">{ai.provider === "openai" ? "AI answers on" : "Answers composed without AI"}</Badge>
        </div>
      </header>

      <div className="about-layout">
        <nav className="about-toc" aria-label="On this page">
          <span className="eyebrow">On this page</span>
          <ul>{SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ul>
        </nav>

        <div className="about-body">
          <section id="overview" className="card">
            <h2>Overview</h2>
            <p>Synora is one search across the places support and engineering knowledge lives: HDA tickets, Azure DevOps work items and wikis, and SharePoint and OneDrive documents. Ask about an issue the way you would ask a colleague. Synora finds what was seen before, what caused it and what fixed it, and answers with citations to the records themselves.</p>
            <p>It is built to be trustworthy rather than merely fluent: it only uses records you are allowed to open, every claim links to its source, confidence is calculated from the evidence, and when the evidence isn&apos;t good enough it says so instead of guessing.</p>
          </section>

          <section id="features">
            <h2 className="about-h2">Features</h2>
            <div className="a-grid">{FEATURES.map(([icon, title, text]) => (
              <article key={title} className="card about-feature"><Icon name={icon} size={20} /><h3>{title}</h3><p className="small muted">{text}</p></article>
            ))}</div>
          </section>

          <section id="sources" className="card">
            <h2>Connected sources</h2>
            <p className="small muted">Live from this installation.{isAdmin ? <> Manage them on <Link href="/sources">Sources</Link>.</> : null}</p>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Source</th><th>Space</th><th>Status</th><th className="r">Records</th><th>Last sync</th></tr></thead>
              <tbody>{connectors.map((c) => (
                <tr key={c.id}><td>{c.name}</td><td>{c.space.name}</td><td><StatusPill status={c.status} /></td><td className="r num">{c.recordCount.toLocaleString("en-GB")}</td>
                  <td>{c.lastSyncAt ? c.lastSyncAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never"}</td></tr>
              ))}</tbody>
            </table></div>
          </section>

          <section id="answers" className="card">
            <h2>How answers work</h2>
            <ol className="about-steps">
              <li><b>Understand the question.</b> References (ticket numbers, WI-123), error codes and application names are recognized without AI.</li>
              <li><b>Find evidence.</b> Hybrid search combines meaning (vector similarity) and keywords, filtered inside the database to records you may open.</li>
              <li><b>Check there is enough.</b> With too little authorized evidence, no AI is called and you are told so.</li>
              <li><b>Write the answer.</b> The model gets only the evidence passages and must cite them, in a strict format.</li>
              <li><b>Check the citations.</b> Citations that weren&apos;t in the evidence are dropped; a sentence left without one is removed.</li>
              <li><b>Calculate confidence and warnings.</b> From the evidence: agreement, approved knowledge, confirmed root causes, fixes that were only temporary, age.</li>
            </ol>
            <span className="eyebrow">Evidence types you will see</span>
            <dl className="rd-dl">
              <dt><KindBadge kind="approved" /></dt><dd>Reviewed guidance: knowledge articles, and SharePoint folders or wiki paths marked as approved.</dd>
              <dt><KindBadge kind="historical" /></dt><dd>Solved HDA tickets. What worked before, not yet approved as reusable knowledge.</dd>
              <dt><KindBadge kind="dev_work" /></dt><dd>Azure DevOps work items. Findings may change as work progresses.</dd>
              <dt><KindBadge kind="reference" /></dt><dd>Documentation: SharePoint and OneDrive files, wiki pages. Check it is still current.</dd>
              <dt><KindBadge kind="discussion" /></dt><dd>Email or chat. Statements here have not been validated.</dd>
            </dl>
          </section>

          <section id="guides" className="card">
            <h2>Help guides</h2>
            <Guide title="Ask a good question">
              <p>Describe what you see, not what you think the cause is: the application, the symptom, any error text, where and since when. For example: &quot;Rx.NET printing jobs stuck in AWAITING PRINT at the Labex site since this morning&quot;.</p>
              <ul><li>Paste error messages and ticket numbers as they are; Synora recognizes references like A3415102L or WI-206985 and finds them exactly.</li><li>Use <b>Investigate incident</b> when you need possible causes, not just similar cases.</li><li>Use the space selector to narrow the search to one department.</li></ul>
            </Guide>
            <Guide title="Read an answer">
              <ul>
                <li>Each sentence ends with citations. Click one to open the record in the side panel, then <b>Open original source</b> to see it in HDA, Azure DevOps or SharePoint.</li>
                <li>The confidence level and warnings come from the evidence. A warning that a fix was only temporary means restarts helped before but the cause wasn&apos;t confirmed.</li>
                <li>If Synora says the evidence isn&apos;t enough, that is deliberate. Try different words, a wider space, or check the source directly.</li>
                <li>Use the thumbs up or down: feedback shows where knowledge is missing.</li>
              </ul>
            </Guide>
            <Guide title="Search records and filter">
              <p>Choose <b>Search records</b> to get a list instead of an answer. <b>Filters</b> narrow by source, record type, evidence type and last update. Searches look at the meaning of your words as well as the words themselves, in several languages.</p>
            </Guide>
            <Guide title="Find similar issues">
              <p>Open <Link href="/similar">Similar Issues</Link> and paste or describe an incident. Synora groups historical records that describe the same symptoms, with what fixed them and how often the problem came back.</p>
            </Guide>
            <Guide title="Save and pin">
              <p>Pin a record from its side panel, or save a search from its results. Everything is under <Link href="/saved">Saved</Link>, where you can group items into collections.</p>
            </Guide>
            <Guide title="Keyboard shortcuts">
              <dl className="rd-dl"><dt><kbd>/</kbd></dt><dd>Focus the search box</dd><dt><kbd>Enter</kbd></dt><dd>Submit (Shift+Enter for a new line)</dd><dt><kbd>Esc</kbd></dt><dd>Close dialogs and panels</dd></dl>
            </Guide>
          </section>

          <section id="admin" className="card">
            <h2>For administrators</h2>
            <Guide title="Start and stop Synora">
              <p>Double-click <b>Start Synora</b> to start Docker, the database, the web app and the sync worker; <b>Stop Synora</b> stops them and keeps all data. Syncs that were interrupted continue from where they stopped after the next start. Run only one sync worker at a time.</p>
            </Guide>
            <Guide title="HDA Ticketing">
              <ol><li>Set <code>HDA_USERNAME</code> and <code>HDA_PASSWORD</code> in <code>.env</code> and connect to the VPN.</li><li>On the HDA card, choose <b>Owner groups</b>, search and activate the groups whose tickets Synora should index. Deactivating a group removes its tickets.</li><li><b>Test connection</b>, then <b>Sync</b>. <code>npm run hda:discover</code> checks the field mapping in <code>config/hda-mapping.json</code>.</li></ol>
            </Guide>
            <Guide title="Azure DevOps (work items and wiki)">
              <ol><li>Create a personal access token with only the <b>Work Items (Read)</b> and <b>Wiki (Read)</b> scopes and set <code>ADO_PAT</code> in <code>.env</code>.</li><li>Connect a source → Azure DevOps → <b>Add Azure DevOps</b>, then <b>Test connection</b> and <b>Sync</b>. Wiki pages are read first, then work items.</li><li>In <code>config/ado-mapping.json</code>, list wiki paths in <code>wiki.approvedPaths</code> to count them as approved knowledge, or exclude work item types with <code>excludeWorkItemTypes</code>.</li></ol>
            </Guide>
            <Guide title="SharePoint & OneDrive">
              <ol><li>IT registers the app (delegated Microsoft Graph permissions <code>Files.Read.All</code>, <code>Sites.Read.All</code>, <code>offline_access</code>, <code>User.Read</code>; redirect URI <code>/api/connectors/m365/callback</code>). Set <code>M365_TENANT_ID</code>, <code>M365_CLIENT_ID</code>, <code>M365_CLIENT_SECRET</code> and <code>M365_SITE_URL</code>.</li><li>Connect a source → SharePoint → <b>Add SharePoint &amp; OneDrive</b>, then <b>Sign in to Microsoft 365</b> on its card.</li><li>Choose <b>Folders</b>: open the site&apos;s libraries or your OneDrive, choose folders, and tick <b>Approved knowledge</b> for reviewed guidance.</li></ol>
            </Guide>
            <Guide title="Who sees what">
              <p>Every signed-in person can search every space that isn&apos;t restricted. Restricted spaces (HR) need a membership, given on <Link href="/admin">Administration</Link> or by Entra app roles in production. HR tickets stay limited to their HDA owner group in any case.</p>
            </Guide>
            <Guide title="AI answers">
              <p>Set <code>AI_PROVIDER=openai</code>, the gateway settings and <code>OPENAI_API_KEY</code>. External AI stays off until <code>AI_DATA_PROCESSING_APPROVAL_REF</code> is set; until then answers are composed from the evidence without AI, and they say so.</p>
            </Guide>
          </section>

          <section id="troubleshooting" className="card">
            <h2>Troubleshooting</h2>
            <dl className="rd-dl about-dl">
              <dt>&quot;Synora found evidence but could not write an answer&quot;</dt><dd>The AI gateway failed. Check <code>OPENAI_API_KEY</code> and the gateway; the supporting records are still shown.</dd>
              <dt>HDA: &quot;could not be reached&quot;</dt><dd>Connect to the company VPN; HDA is only reachable on the corporate network.</dd>
              <dt>HDA: &quot;answered with an error page&quot;</dt><dd>HDA QA is briefly unavailable. The sync retries and the next run continues where it stopped.</dd>
              <dt>A source stays on &quot;Syncing&quot;</dt><dd>Check the sync worker window is open (or start Synora again). Interrupted syncs resume within a few minutes.</dd>
              <dt>Azure DevOps: &quot;refused&quot;</dt><dd>The token expired or lacks a scope; create a new one with Work Items (Read) and Wiki (Read).</dd>
              <dt>SharePoint: &quot;sign-in has expired&quot;</dt><dd>Choose <b>Sign in to Microsoft 365</b> on the card again.</dd>
              <dt>A record you expect is missing</dt><dd>Check its source is connected and synced, the HDA owner group or SharePoint folder is chosen, and the space isn&apos;t restricted for you.</dd>
            </dl>
          </section>

          <section id="privacy" className="card">
            <h2>Privacy & security</h2>
            <ul className="about-list">
              <li><Icon name="lock" size={16} /><span>Permissions are applied inside the database query, before anything reaches you or the AI.</span></li>
              <li><Icon name="shield" size={16} /><span>Sensitive HDA ticket types (security incidents, IP violations, report leaks) are never copied into Synora.</span></li>
              <li><Icon name="users" size={16} /><span>People&apos;s names (assignees, contacts, authors) are shown in the record panel only; they are never part of the searchable text or sent to the AI.</span></li>
              <li><Icon name="cpu" size={16} /><span>Embeddings and image text recognition run on the Synora server, so indexing sends no content outside.</span></li>
              <li><Icon name="sparkles" size={16} /><span>AI runs only through the company gateway, with <code>store:false</code>, allow-listed hosts and a data-processing approval reference.</span></li>
              <li><Icon name="link" size={16} /><span>All source access is read-only. Tokens and passwords stay in <code>.env</code> or are stored encrypted, and are never shown in the app.</span></li>
            </ul>
          </section>

          <section id="stack" className="card">
            <h2>Tech stack</h2>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Area</th><th>Technology</th><th>Version</th></tr></thead>
              <tbody>{STACK.map(([area, tech, p]) => <tr key={area}><td><b>{area}</b></td><td>{tech}</td><td className="mono small">{version(p) || "—"}</td></tr>)}</tbody>
            </table></div>
            <p className="small muted">Pipeline: connector → change check, chunking, local embeddings, permissions → PostgreSQL + pgvector. Question → hybrid retrieval with the permission filter in SQL → evidence check → answer → citation check → streamed to the page.</p>
          </section>

          <section id="glossary" className="card">
            <h2>Glossary</h2>
            <dl className="rd-dl about-dl">{GLOSSARY.map(([t, d]) => <div key={t} style={{ display: "contents" }}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
          </section>
        </div>
      </div>
    </div>
  );
}

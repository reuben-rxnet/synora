# Synora — Enterprise AI Search Results Experience: Full Implementation Specification

## 1. Role and objective

Act as a Principal Full-Stack Engineer, AI Search Architect, RAG Engineer, Information Retrieval Specialist, and Senior UI/UX Designer.

I am developing Synora, an enterprise intelligence and knowledge search platform that indexes information from connected enterprise systems and generates source-backed answers.

My objective is to make Synora's search experience comparable in usefulness, clarity, and answer quality to leading AI assistants such as ChatGPT and Claude, specifically for enterprise knowledge discovery, application support, incident investigation, and technical troubleshooting.

I want you to implement the redesigned search results experience directly in the existing Synora application.

**This is an implementation task, not merely a design exercise.** The final result must use actual indexed data, the existing search pipeline, verified citations, connected-source metadata, and permission-aware retrieval.

Do not create a disconnected prototype. Do not replace production data with hardcoded examples. Do not perform a wholesale rewrite without a demonstrated technical need.

---

## 2. Mandatory design reference

The approved design reference is stored at:

`D:\Projects\Synora\Design Reference\Synora Enterprise AI Search Dashboard.png`

Before making any UI changes:

1. Open and inspect this image.
2. Understand the intended layout, navigation, typography, colours, spacing, answer panel, evidence panel, source filters, status indicators, and overall visual hierarchy.
3. Use this image as the primary visual specification for the implementation.
4. Inspect the existing Synora application and determine which components and styles must change.
5. Reproduce the design within the existing application rather than building a separate mock-up.
6. After implementation, run the application and compare the actual rendered result against the reference image.
7. Capture a screenshot of the implemented application and address significant visual differences.

If the file is inaccessible, check the specified path and project workspace. Report the problem rather than silently substituting another design.

The reference image is a visual guide, not permission to invent source records or backend behaviour.

The interface must be responsive. Do not force the entire application into a fixed 16:9 viewport.

---

## 3. Inspect the existing repository first

Before modifying code, inspect the repository and understand the current architecture.

Pay particular attention to:

- `src/app/` — application pages, layouts, and API routes.
- `src/components/` — existing UI components.
- `src/lib/search/` — query processing, retrieval, ranking, evidence checks, answer generation, citation validation, and streaming.
- `src/lib/ingest/` — ingestion, chunking, embeddings, metadata, permissions, and record links.
- `src/lib/connectors/` — connector implementations, registry, synchronization, and source-specific logic.
- `src/worker/` — background synchronization and indexing jobs.
- `prisma/schema.prisma` — database schema.
- `scripts/db-indexes.ts` — vector, full-text, and related database indexes.
- `config/hda-mapping.json` — HDA ticket mappings.
- `config/ado-mapping.json` — Azure DevOps mappings.
- `config/m365-mapping.json` — SharePoint and OneDrive mappings.
- Existing search APIs, answer-generation prompts, response schemas, and UI state management.
- Existing tests, styling conventions, component libraries, and application scripts.

Trace the complete data flow:

User query → query understanding → retrieval → permission filtering → ranking → evidence assembly → answer generation → citation validation → streaming → rendered answer and evidence.

Verify the actual implementation instead of relying exclusively on documentation.

Identify which components can be reused, which require modification, and which genuine gaps must be addressed.

Do not duplicate existing APIs or introduce unnecessary dependencies.

### Required initial assessment

Before significant changes, identify:

- The current search results page and relevant components.
- The shape of the existing search response.
- How evidence records and citations are represented.
- How connected sources and record URLs are stored.
- How confidence and relevance are calculated.
- How permissions are enforced.
- How streaming and loading states work.
- Any backend limitations that prevent the target design from functioning.

Once the audit is complete, proceed with the implementation in small, testable increments.

---

## 4. Connected sources and evidence coverage

Synora must retrieve, rank, and present supporting evidence from all relevant connected and indexed sources that the current user is authorized to access.

The source types documented for the current application include:

### A. HDA Ticketing

Potential evidence includes:

- Incidents.
- Service requests.
- Historical symptoms.
- Resolution notes.
- Confirmed root causes.
- Temporary workarounds.
- Related ticket records.
- Linked technical documentation.

Use the existing HDA connector and field mappings.

### B. Azure DevOps

Potential evidence includes:

- Bugs.
- User stories.
- Tasks and work items.
- Work item comments.
- Project wiki pages.
- Related and duplicate work items.
- Development investigations and fixes.

Preserve existing work item references and cross-links to HDA tickets.

### C. SharePoint

Potential evidence includes:

- Technical documents.
- Approved runbooks.
- Procedures.
- Architecture documentation.
- Knowledge documents from configured libraries and folders.

Respect the current Microsoft 365 authentication, folder selection, and permission model.

### D. OneDrive

Potential evidence includes:

- Technical notes.
- Troubleshooting guides.
- Supporting documents.
- Other supported files in authorized folders.

Use the existing OneDrive integration and indexed metadata.

### E. Demonstration data

Use demonstration records only when they are genuinely part of the indexed corpus and relevant to the query.

Clearly identify them as demonstration records. Never present fictional demonstration content as a verified production incident.

### F. Future connectors

The architecture may support future integrations such as Outlook, Microsoft Teams, Confluence, CSV, and MCP.

Do not display these as connected or retrieve their content unless the corresponding functionality is implemented, enabled, and available.

### Cross-source retrieval requirements

When a user submits a query, Synora must search across all relevant enabled sources available to that user.

Do not stop at the first matching connector or source type.

Where appropriate, retrieve evidence from multiple systems and synthesize the results into one answer.

For example, a question about RxCNC connections that recover after a restart but time out again later might benefit from:

- An HDA incident documenting the symptom and recovery action.
- Another incident showing a similar recurrence.
- An Azure DevOps work item investigating timeout errors.
- A SharePoint runbook describing service monitoring and auto-restart behaviour.
- An authorized OneDrive technical note containing relevant diagnostic guidance.

These are illustrative examples, not guaranteed records. Retrieve and display only evidence that actually exists and is relevant.

Do not invent missing documents, ticket identifiers, work items, source titles, dates, or resolution details.

If only HDA contains relevant evidence, return the relevant HDA evidence. If several sources contribute useful evidence, include them together.

If a source is unavailable or has not synchronized successfully, do not silently imply that it was searched successfully.

---

## 5. Target search results interface

Implement the attached reference design within the existing Synora application.

Preserve the current dark navy navigation sidebar, Synora branding, blue-purple accents, rounded cards, and enterprise-friendly design language.

### A. Existing sidebar

Retain the existing navigation and functionality:

- Search.
- Similar Issues.
- Analytics.
- Sources.
- Saved.
- Administration.
- About.
- Help.
- Current-user information.

Preserve routing, active navigation states, authentication, and existing access controls.

### B. Search header

Implement a clean header containing:

- Current search query.
- Query editing and clearing.
- Search submission.
- Space selection.
- Existing search filters.
- Help and profile controls where appropriate.

Add functional result tabs:

- **Answer**
- **Evidence & Sources**
- **Related Issues**
- **Follow-up Questions**

The tabs must use actual search-session data.

Changing a tab must not unnecessarily repeat expensive searches or model calls.

Preserve the existing search and conversation behaviour.

### C. Main answer panel

The main panel should prioritize the answer instead of requiring users to inspect multiple records before understanding the result.

Include, where available:

- Synora assistant identity.
- Answer heading.
- Direct response to the query.
- Number of supporting records.
- Evidence freshness information.
- Evidence status.
- Root-cause confirmation status.
- Permission-aware indicator.
- Confidence or evidence-sufficiency information.
- Relevant citations.

Use concise, readable typography and clear information hierarchy.

The answer must start with the most useful conclusion supported by the available evidence.

Do not force every response into a troubleshooting template.

For factual questions, answer directly. For comparisons, show the differences. For summaries, present key findings. For troubleshooting, use the structured format described below.

### D. Evidence and source status

Show status indicators only when their underlying meaning is supported by actual application data.

Distinguish:

- Evidence retrieved.
- Approved knowledge available or unavailable.
- Root cause confirmed or unconfirmed.
- Temporary recovery versus verified permanent resolution.
- Permission-aware retrieval.
- Evidence freshness.

Do not show a green success indicator simply because search returned records.

Do not imply that the existence of supporting documents establishes a confirmed root cause.

---

## 6. Evidence across connected sources panel

Implement the right-hand evidence panel from the design reference.

The panel should make it immediately clear which records support the generated answer.

### Panel header

Display:

- Heading: `Evidence across connected sources`
- Total number of relevant records.
- Source-type filters.
- A ranked list of supporting records.

Generate filter options from the actual available source types.

Possible filters include:

- All Sources.
- HDA.
- Azure DevOps.
- SharePoint.
- OneDrive.
- Demonstration Data.

Only show filters that correspond to supported source types. Where useful, show the number of relevant records per source.

### Evidence cards

Each card should display available information such as:

- Source icon or type indicator.
- Source name.
- Record identifier.
- Record title.
- Record category.
- Date or freshness information.
- Relevant text excerpt.
- Relevance indicator.
- Evidence role.
- Resolution or approval status, where supported.
- Link to the original record.

Evidence roles should distinguish between:

- Direct supporting evidence.
- Similar historical incident.
- Authoritative documentation.
- Investigation in progress.
- Confirmed resolution.
- Temporary workaround.
- Contradictory evidence.
- Background context.

Do not assign these labels unless supported by source metadata or verified analysis.

Keep evidence cards concise. Display only the excerpt relevant to the question and allow the user to expand a card for additional details.

### Evidence ordering

Rank records according to their actual relevance and value in supporting the answer.

Evaluate signals such as:

- Semantic relevance.
- Keyword relevance.
- Exact ticket ID and error-code matches.
- Source authority.
- Approved knowledge status.
- Document freshness.
- Root-cause confirmation.
- Resolution quality.
- Temporary versus permanent fixes.
- Agreement or disagreement with other sources.
- Duplicate content.

Do not automatically rank the newest document first or allow an approval flag to override strong relevance signals.

Do not fabricate numerical relevance percentages.

If the existing score represents retrieval relevance, label it as such. Do not present it as the probability that the answer is correct.

### Evidence counts and filtering

The evidence count must correspond to the actual relevant records returned by the search pipeline.

If records are paginated, distinguish between total matching records and currently displayed records.

Source filters must operate on real evidence records, update the visible list, and preserve the answer's citation integrity.

Do not replace evidence with fabricated records when a filter returns no results.

Show a clear empty state for a source with no relevant evidence.

### Source navigation

Provide functional links for available source records:

- HDA tickets.
- Azure DevOps work items.
- Azure DevOps wiki pages.
- SharePoint documents.
- OneDrive files.
- Demonstration records.

Reuse existing source identifiers and navigation mechanisms.

If a direct link is unavailable, provide a useful source-detail view or explain that the source cannot be opened directly.

All navigation must preserve the current user's permissions.

---

## 7. Answer generation and reasoning quality

Review the existing answer-generation prompt, evidence assembly, response schema, and post-processing logic.

Improve the answer-generation instructions where necessary.

Synora should synthesize relevant evidence into a coherent, useful response rather than merely concatenate search snippets.

### Required answer qualities

Every answer should be:

- Directly responsive to the query.
- Grounded in retrieved evidence.
- Appropriately detailed.
- Clear and well structured.
- Free of unsupported factual claims.
- Transparent about uncertainty.
- Supported by relevant citations.
- Actionable where the evidence permits.

Avoid generic introductions, repetitive summaries, and excessive headings.

### Query-specific response formats

For technical troubleshooting, use appropriate sections such as:

1. Summary.
2. Likely explanation.
3. Supporting evidence.
4. Recommended investigation.
5. What remains unknown.
6. Validation criteria.
7. Related incidents and documentation.

For factual questions, provide a direct answer with supporting citations.

For comparisons, show the material similarities and differences and identify the evidence for each.

For multi-document questions, synthesize the relevant information across sources.

For insufficient evidence, explain what is missing and ask a targeted clarification if necessary.

### Separate facts from hypotheses

Clearly distinguish:

- Facts explicitly stated in source records.
- Patterns observed across multiple records.
- AI-generated interpretations.
- Unconfirmed root-cause hypotheses.
- Recommended diagnostic actions.
- Verified corrective actions.

Do not describe historical correlation as a confirmed root cause.

Do not present a service restart as a permanent fix merely because it temporarily restored service.

Do not invent commands, configuration values, logs, or procedures.

When recommending a diagnostic step that is not directly documented, present it as a recommendation or hypothesis rather than as official organizational guidance.

### Example: RxCNC recurring timeouts

For a question such as:

"RxCNC connections work after a server restart but begin timing out again after a few hours."

A good response should explain that the restart appears to restore service temporarily if the retrieved records establish that pattern.

It should then:

- Identify the most relevant historical incidents.
- Explain what their resolution notes actually establish.
- Retrieve relevant Azure DevOps investigations.
- Consult authorized SharePoint and OneDrive documentation when available.
- Distinguish the observed pattern from the unconfirmed underlying cause.
- Recommend relevant diagnostic checks.
- Explain how to validate whether a permanent fix has worked.

Potential investigation areas might include service logs, network connectivity, dependent services, resource usage, and timeout configuration, but only recommend checks appropriate to the actual evidence and system.

The system must not invent a definitive cause merely to make the answer sound authoritative.

---

## 8. Citations and source traceability

Implement reliable claim-to-source traceability.

Requirements:

- Attach citations to the factual claims they support.
- Use stable source identifiers.
- Display understandable source titles and metadata.
- Make citations clickable when a valid source link exists.
- Preserve the citation relationship through streaming and post-processing.
- Remove invalid citations without leaving broken sentences.
- Prevent unsupported claims from appearing as verified facts.
- Respect source permissions when opening records.
- Surface material contradictions between sources.

For example, if the answer says that a service restart temporarily restored connectivity, the citation should open the record that documents that recovery action.

If a separate document describes configured auto-restart behaviour, cite that document for the documented behaviour rather than using it as proof of the underlying incident's root cause.

Do not treat citation presence as proof of factual correctness.

---

## 9. Confidence and evidence sufficiency

Audit the existing confidence calculation before changing the UI.

Determine whether the current score represents retrieval relevance, evidence strength, or calibrated answer reliability.

Do not conflate these concepts.

Consider:

- Relevance of retrieved evidence.
- Number and independence of supporting records.
- Source authority.
- Approved knowledge.
- Agreement between sources.
- Presence of confirmed root causes.
- Quality of historical resolutions.
- Evidence freshness.
- Citation coverage.
- Historical evaluation performance.

Do not assign arbitrary confidence values.

If confidence is not calibrated against labelled evaluation data, use a truthful evidence-status indicator rather than a misleading probability.

The system should know when to:

- Answer directly.
- Answer with caveats.
- Ask for clarification.
- Explain that evidence is insufficient.

---

## 10. Streaming, loading, and interaction design

Improve the existing search experience while preserving the current architecture.

Support progressive answer rendering where the existing streaming implementation permits it.

Use meaningful progress stages such as:

- Understanding the question.
- Searching accessible sources.
- Ranking evidence.
- Preparing a source-backed answer.

Only show a stage as completed when the corresponding operation has actually completed.

Ensure the layout remains stable while the answer streams.

Handle:

- Search failures.
- Timeouts.
- Empty results.
- Insufficient evidence.
- Cancelled requests.
- Duplicate submissions.
- Partial responses.
- Citation validation failures.

Do not introduce artificial loading delays or progress indicators that misrepresent the actual pipeline.

### Functional controls

All visible controls must perform real actions.

Verify:

- Search submission.
- Query editing and clearing.
- Result tabs.
- Source filters.
- Citation navigation.
- Expand and collapse evidence.
- Follow-up questions.
- Related issue navigation.
- Copy answer or diagnostic steps, where appropriate.
- Helpful/not helpful feedback.
- Existing search filters.
- Error and empty states.

Do not add decorative controls that do nothing.

---

## 11. Layout, responsiveness, and visual quality

Match the provided reference image while retaining the existing Synora design system.

### Desktop

Use a balanced two-column result layout:

- Main answer and investigation panel.
- Supporting evidence panel.

The main answer should receive enough space for readable technical explanations. The evidence panel should remain wide enough to display source titles and excerpts.

### Smaller screens

Stack the answer and evidence sections vertically or use a collapsible evidence panel.

### Visual design

Maintain:

- Dark navy sidebar.
- Blue-purple accent colours.
- White or light neutral content surfaces.
- Rounded cards.
- Restrained shadows.
- Consistent typography.
- Clear spacing and alignment.
- Distinct source-type indicators.
- Accessible contrast.
- Consistent iconography.

Avoid oversized empty areas, excessive decorative elements, and overly dense evidence cards.

### Scrolling and layout

Fix the current layout issues where the fixed search composer can cover answer content.

Ensure:

- The full answer remains accessible.
- Evidence lists can be navigated.
- There are no unnecessary nested scrollbars.
- Long answers do not break the layout.
- Fixed controls do not obscure citations or action buttons.
- Browser zoom and keyboard navigation remain usable.

Use the 16:9 reference image as a visual guide, not as a fixed viewport requirement.

---

## 12. Search quality and retrieval improvements

Do not limit this task to the frontend if the existing retrieval pipeline prevents the desired experience.

Inspect and evaluate:

- Hybrid vector and keyword search.
- Exact matching for ticket IDs, error codes, and technical identifiers.
- Query normalization and rewriting.
- Rank fusion.
- Reranking.
- Duplicate-result suppression.
- Chunking and metadata preservation.
- Approved knowledge and source authority.
- Document freshness.
- Permanent fixes versus temporary workarounds.
- Cross-source retrieval.
- Evidence assembly.
- Contradictory evidence.
- Appropriate abstention.

Make changes only when the current implementation or evaluation results justify them.

If advanced techniques such as cross-encoder reranking or query decomposition may help, evaluate them experimentally before introducing them into production.

Do not add new external services, paid APIs, or unapproved model providers without explaining the need, alternatives, security implications, and expected benefit.

---

## 13. Evaluation framework

Establish a repeatable evaluation process for search and answer quality.

Start with at least 200 representative queries, including:

- Exact ticket lookups.
- Error-code searches.
- Incident root causes.
- Historical resolutions.
- Troubleshooting questions.
- Approved runbooks.
- Azure DevOps investigations.
- SharePoint and OneDrive documentation.
- Cross-source questions.
- Contradictory records.
- Outdated knowledge.
- Ambiguous questions.
- Questions with insufficient evidence.
- Permission-restricted records.

Use authorized enterprise data only. Otherwise, use representative synthetic test records.

Measure retrieval quality using:

- Recall@5 and Recall@10.
- Precision@5 and Precision@10.
- Mean Reciprocal Rank.
- NDCG@10.
- Exact-identifier retrieval success.
- Duplicate-result rate.

Measure answer quality using:

- Factual correctness.
- Completeness.
- Evidence faithfulness.
- Citation precision and coverage.
- Unsupported-claim rate.
- Appropriate abstention.
- Helpfulness and actionability.

Measure performance using:

- p50 and p95 search latency.
- End-to-end answer latency.
- Model calls and token usage.
- Cost per query, where measurable.
- Error and timeout rates.

Establish the current baseline before claiming improvements.

Use regression tests to ensure that better retrieval does not weaken permissions, citation accuracy, or performance.

---

## 14. Security and enterprise requirements

Preserve Synora's existing permission-aware architecture.

- Enforce access control before evidence reaches the AI model.
- Respect source-level and record-level permissions.
- Do not expose restricted content through excerpts, citations, related records, cached responses, or conversation history.
- Preserve the existing exclusion rules for sensitive HDA ticket types.
- Treat retrieved documents as untrusted content.
- Prevent prompt injection from indexed documents.
- Preserve existing AI data-processing approval controls.
- Avoid unnecessary logging of sensitive information.
- Maintain the current authentication and authorization model.

Do not broaden permissions to improve search recall.

---

## 15. Implementation sequence

### Phase 1 — Audit and baseline

Inspect the repository and report:

- Existing components to reuse.
- Components requiring modification.
- Current search response structure.
- Evidence and citation data contracts.
- Connected-source integration.
- Permission enforcement.
- Identified UI and retrieval gaps.

### Phase 2 — Implement the reference design

Build the answer-first layout, supporting evidence panel, source filters, result tabs, and responsive behaviour using real search results.

### Phase 3 — Integrate connected sources

Ensure the search experience displays relevant evidence from all enabled, indexed, authorized sources.

Implement correct source metadata, source links, evidence ranking, and cross-source synthesis.

### Phase 4 — Improve answer quality

Fix confirmed problems in evidence assembly, answer generation, citation validation, and insufficient-evidence handling.

### Phase 5 — Test and refine

Run the application, compare the rendered page with the design reference, capture screenshots, and fix significant visual and functional defects.

Run automated tests and report measured results.

---

## 16. Definition of done

The implementation is complete when:

1. The search results page closely follows the approved design reference.
2. The interface uses the actual Synora search pipeline.
3. Answers are direct, clear, and evidence-backed.
4. Evidence can be retrieved across all relevant enabled and authorized connected sources.
5. Source filters work correctly.
6. Evidence is ranked and displayed with useful metadata.
7. Citations open the correct authorized source records.
8. Facts, hypotheses, and recommendations are clearly distinguished.
9. Confidence indicators accurately represent their underlying meaning.
10. The composer no longer obscures results.
11. The interface works across desktop and smaller screens.
12. Existing connectors, authentication, permissions, and navigation continue to function.
13. Relevant automated tests pass, or existing failures are documented.
14. A screenshot of the actual implementation is captured and compared with the reference image.
15. Remaining limitations and risks are documented.

## 17. Final working instructions

Work directly in the existing Synora repository.

Do not create a standalone mock-up.

Do not hardcode the example RxCNC records or source cards into production components.

Do not invent connected sources, indexed records, citations, confidence values, or search results.

Do not replace working components unnecessarily.

Use the actual design reference stored at:

`D:\Projects\Synora\Design Reference\Synora Enterprise AI Search Dashboard.png`

Start by inspecting the repository and identifying the exact components and data contracts involved.

Then implement the experience in small, testable increments, preserving the existing security architecture.

Run the relevant checks and tests, inspect the rendered result, and report the exact files changed, functionality implemented, test results, and outstanding limitations.

**The ultimate objective is a production-integrated enterprise AI search experience in which users receive a high-quality answer and can immediately verify that answer against the strongest supporting evidence from their authorized connected sources.**

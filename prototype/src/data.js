// Synora prototype — demonstration data only.
// Nothing here comes from a live system. All references, people and values are fictional.

export const DEMO_LABEL = 'Demonstration data';

export const SOURCES = ['HDA Ticketing', 'Azure DevOps', 'SharePoint', 'OneDrive', 'Outlook', 'Teams', 'Confluence', 'Knowledge base'];
export const APPLICATIONS = ['RxCNC', 'Rx.Net', 'LABEX', 'VisionStar', 'EOLP', 'Tristar', 'Order Import', 'ECM API', 'Print queues', 'Service monitoring'];
export const ENVIRONMENTS = ['Production', 'Pre-production', 'Test', 'Development'];
export const LOCATIONS = ['Dallas lab', 'Lyon lab', 'Bangkok lab', 'Manaus lab', 'Dublin hub', 'Singapore hub'];
export const OWNER_GROUPS = ['App Support – Lab Systems', 'App Support – Order Flow', 'Integration Team', 'Infrastructure Ops', 'Service Desk L1', 'Platform Engineering'];
export const PRIORITIES = ['P1 – Critical', 'P2 – High', 'P3 – Medium', 'P4 – Low'];
export const CATEGORIES = ['Connectivity', 'Performance', 'Order launch', 'Printing', 'Data sync', 'Authentication', 'Configuration', 'Monitoring'];
export const STATUSES = ['Open', 'In progress', 'Under investigation', 'Resolved', 'Closed'];
export const RECORD_TYPES = ['Incident', 'Bug', 'Work item', 'Document', 'Email', 'Chat thread', 'Knowledge article'];
export const MODULES = ['Connection manager', 'Job dispatcher', 'Order launch', 'Print spooler', 'Integration gateway', 'Auth service', 'Scheduler', 'Monitoring agent'];

// Evidence kinds drive how a citation is labelled.
export const EVIDENCE_KINDS = {
  approved: { label: 'Approved knowledge', tone: 'good' },
  historical: { label: 'Historical incident evidence', tone: 'info' },
  email: { label: 'Email discussion', tone: 'neutral' },
  devwork: { label: 'Development work item', tone: 'violet' },
  ai: { label: 'AI-generated interpretation', tone: 'ai' },
};

export const RECORDS = [
  {
    id: 'r1', ref: 'A5058563L', title: 'RxCNC lab clients lose connection to CNC server, recover after restart',
    source: 'HDA Ticketing', type: 'Incident', kind: 'historical', application: 'RxCNC', module: 'Connection manager',
    environment: 'Production', location: 'Dallas lab', ownerGroup: 'App Support – Lab Systems', priority: 'P2 – High',
    category: 'Connectivity', status: 'Closed', created: '2026-03-04', updated: '2026-03-11', approval: 'Historical – not approved',
    excerpt: 'Generators in the surfacing area reported "connection timed out" when sending jobs to RxCNC. A restart of the RxCNC service restored connectivity. Timeouts returned roughly 5–6 hours later on the same day.',
    rootCause: 'Not confirmed. Engineer note: "possibly sockets left open by the job dispatcher".',
    resolution: 'Service restart provided temporary recovery. Ticket closed after 48 hours without recurrence.',
    symptom: 'Connectivity restored after restart and degraded later', similarity: 94, recurrence: 4, errors: ['ERR_CONN_TIMEOUT', 'Socket read timed out after 30000 ms'],
  },
  {
    id: 'r2', ref: 'BUG-1842', title: 'Connection pool in RxCNC dispatcher does not release sessions after job abort',
    source: 'Azure DevOps', type: 'Bug', kind: 'devwork', application: 'RxCNC', module: 'Job dispatcher',
    environment: 'Pre-production', location: 'Dublin hub', ownerGroup: 'Platform Engineering', priority: 'P2 – High',
    category: 'Performance', status: 'Under investigation', created: '2026-04-18', updated: '2026-10-14', approval: 'Work item – not knowledge',
    excerpt: 'Load test shows active sessions climbing from 40 to 512 (pool max) over ~4 hours when jobs are aborted mid-transfer. New requests then wait for a free session and time out.',
    rootCause: 'Suspected: aborted jobs do not return their session to the pool.',
    resolution: 'Fix in development. Interim mitigation under discussion.',
    similarity: 87, recurrence: 0, errors: ['Pool exhausted: 512/512 sessions in use', 'ERR_CONN_TIMEOUT'],
    linkedTo: 'A5058563L',
  },
  {
    id: 'r3', ref: 'KB-RX-0217', title: 'RxCNC Connectivity Troubleshooting Guide',
    source: 'SharePoint', type: 'Document', kind: 'approved', application: 'RxCNC', module: 'Connection manager',
    environment: 'Production', location: 'All locations', ownerGroup: 'App Support – Lab Systems', priority: '—',
    category: 'Connectivity', status: 'Published', created: '2025-09-02', updated: '2026-08-21', approval: 'Approved',
    excerpt: 'Section 3: Check established and CLOSE_WAIT sockets on the RxCNC host. Section 4: Review the connection-pool metrics in the monitoring dashboard. Section 6: Confirm the license service and the SQL instance respond within thresholds.',
    rootCause: '—', resolution: 'Structured checks: sockets, application logs, service dependencies and monitoring.',
    similarity: 79, recurrence: 0, errors: [],
  },
  {
    id: 'r4', ref: 'A5061190L', title: 'RxCNC jobs stuck in "sending" at Lyon lab after Windows patching',
    source: 'HDA Ticketing', type: 'Incident', kind: 'historical', application: 'RxCNC', module: 'Connection manager',
    environment: 'Production', location: 'Lyon lab', ownerGroup: 'App Support – Lab Systems', priority: 'P3 – Medium',
    category: 'Connectivity', status: 'Resolved', created: '2026-05-22', updated: '2026-05-23', approval: 'Historical – not approved',
    excerpt: 'After the May patch window, jobs remained in "sending". Firewall rule for port 5021 had been reset by the patch baseline.',
    rootCause: 'Firewall rule reset during patching.', resolution: 'Re-applied firewall rule; added rule to the patch baseline.',
    similarity: 71, recurrence: 1, errors: ['ERR_CONN_REFUSED'],
  },
  {
    id: 'r5', ref: 'MAIL-20260612', title: 'RE: RxCNC timeouts again this afternoon – Dallas',
    source: 'Outlook', type: 'Email', kind: 'email', application: 'RxCNC', module: 'Connection manager',
    environment: 'Production', location: 'Dallas lab', ownerGroup: 'App Support – Lab Systems', priority: '—',
    category: 'Connectivity', status: 'Thread', created: '2026-06-12', updated: '2026-06-13', approval: 'Discussion – not validated',
    excerpt: 'Lab supervisor: "Restart fixed it again but it came back before shift change." Support engineer: "CLOSE_WAIT count was above 400 before the restart. I think something is not closing sockets."',
    rootCause: 'Discussed, not confirmed.', resolution: 'Restart applied; investigation requested.',
    similarity: 76, recurrence: 0, errors: [],
  },
  {
    id: 'r6', ref: 'TEAMS-LAB-0931', title: 'Lab Systems channel: CLOSE_WAIT sockets on RXCNC-APP02',
    source: 'Teams', type: 'Chat thread', kind: 'email', application: 'RxCNC', module: 'Connection manager',
    environment: 'Production', location: 'Dallas lab', ownerGroup: 'Infrastructure Ops', priority: '—',
    category: 'Connectivity', status: 'Thread', created: '2026-09-30', updated: '2026-09-30', approval: 'Discussion – not validated',
    excerpt: 'netstat on RXCNC-APP02 shows 431 CLOSE_WAIT sockets towards the dispatcher port. Count grows by ~90 per hour during peak.',
    rootCause: '—', resolution: '—', similarity: 73, recurrence: 0, errors: [],
  },
  {
    id: 'r7', ref: 'WI-5520', title: 'Add connection-pool saturation alert for RxCNC dispatcher',
    source: 'Azure DevOps', type: 'Work item', kind: 'devwork', application: 'Service monitoring', module: 'Monitoring agent',
    environment: 'Production', location: 'All locations', ownerGroup: 'Platform Engineering', priority: 'P3 – Medium',
    category: 'Monitoring', status: 'In progress', created: '2026-07-01', updated: '2026-10-02', approval: 'Work item – not knowledge',
    excerpt: 'Raise a warning when active sessions exceed 80% of pool size for more than 10 minutes.',
    rootCause: '—', resolution: 'Planned for sprint 41.', similarity: 62, recurrence: 0, errors: [],
  },
  {
    id: 'r8', ref: 'A5049902L', title: 'Order Import API calls time out during month-end batch',
    source: 'HDA Ticketing', type: 'Incident', kind: 'historical', application: 'Order Import', module: 'Integration gateway',
    environment: 'Production', location: 'Singapore hub', ownerGroup: 'Integration Team', priority: 'P2 – High',
    category: 'Performance', status: 'Closed', created: '2026-01-31', updated: '2026-02-03', approval: 'Historical – not approved',
    excerpt: 'Order Import returned HTTP 504 from the ECM API gateway during the month-end batch. Gateway timeout was 30 s; batch calls took up to 48 s.',
    rootCause: 'Gateway timeout lower than batch processing time.', resolution: 'Raised gateway timeout to 60 s for the batch route and split batches into 500-order chunks.',
    similarity: 58, recurrence: 3, errors: ['HTTP 504 Gateway Timeout'],
  },
  {
    id: 'r9', ref: 'KB-ECM-0044', title: 'ECM API timeout handling and retry policy',
    source: 'Confluence', type: 'Knowledge article', kind: 'approved', application: 'ECM API', module: 'Integration gateway',
    environment: 'Production', location: 'All locations', ownerGroup: 'Integration Team', priority: '—',
    category: 'Performance', status: 'Published', created: '2025-11-14', updated: '2026-06-30', approval: 'Approved',
    excerpt: 'Callers should retry idempotent requests with exponential back-off (2, 4, 8 s). Do not raise gateway timeouts above 60 s without architecture review.',
    rootCause: '—', resolution: 'Retry with back-off; batch large payloads.', similarity: 55, recurrence: 0, errors: [],
  },
  {
    id: 'r10', ref: 'A5063377L', title: 'Order launch fails with "lens design not found" for new VisionStar products',
    source: 'HDA Ticketing', type: 'Incident', kind: 'historical', application: 'VisionStar', module: 'Order launch',
    environment: 'Production', location: 'Manaus lab', ownerGroup: 'App Support – Order Flow', priority: 'P2 – High',
    category: 'Order launch', status: 'Resolved', created: '2026-08-05', updated: '2026-08-06', approval: 'Historical – not approved',
    excerpt: 'Orders for the new progressive range failed at launch. Product catalogue sync to the lab had not run since the release.',
    rootCause: 'Catalogue sync job disabled after release.', resolution: 'Re-enabled catalogue sync; re-launched 212 orders.',
    similarity: 0, recurrence: 2, errors: ['Lens design not found'],
  },
  {
    id: 'r11', ref: 'KB-OL-0102', title: 'Order-launch failures: top causes and checks',
    source: 'SharePoint', type: 'Knowledge article', kind: 'approved', application: 'EOLP', module: 'Order launch',
    environment: 'Production', location: 'All locations', ownerGroup: 'App Support – Order Flow', priority: '—',
    category: 'Order launch', status: 'Published', created: '2025-06-10', updated: '2026-04-02', approval: 'Approved',
    excerpt: 'Most frequent causes: missing catalogue data (38%), invalid frame tracing (24%), blocked by credit hold (17%), lab routing rule mismatch (12%).',
    rootCause: '—', resolution: 'Check catalogue sync, tracing validation, credit status and routing rules in that order.',
    similarity: 0, recurrence: 0, errors: [],
  },
  {
    id: 'r12', ref: 'A5064410L', title: 'Tristar print queue stops at Bangkok lab, jobs pile up',
    source: 'HDA Ticketing', type: 'Incident', kind: 'historical', application: 'Print queues', module: 'Print spooler',
    environment: 'Production', location: 'Bangkok lab', ownerGroup: 'Infrastructure Ops', priority: 'P3 – Medium',
    category: 'Printing', status: 'Closed', created: '2026-09-12', updated: '2026-09-13', approval: 'Historical – not approved',
    excerpt: 'Job tickets stopped printing. Spooler service hung on a corrupted job from the Tristar label template.',
    rootCause: 'Corrupted spool file from label template v3.2.', resolution: 'Cleared spool folder, restarted spooler, rolled template back to v3.1.',
    similarity: 0, recurrence: 5, errors: ['Spooler subsystem app has stopped'],
  },
  {
    id: 'r13', ref: 'KB-PQ-0011', title: 'Print-queue recovery procedure for lab job tickets',
    source: 'OneDrive', type: 'Document', kind: 'approved', application: 'Print queues', module: 'Print spooler',
    environment: 'Production', location: 'All locations', ownerGroup: 'Infrastructure Ops', priority: '—',
    category: 'Printing', status: 'Published', created: '2025-03-19', updated: '2025-12-01', approval: 'Approved',
    excerpt: 'Stop spooler, move files from the spool folder to quarantine, start spooler, re-send the last 20 jobs from Tristar.',
    rootCause: '—', resolution: 'Quarantine spool files, restart spooler, re-send jobs.', similarity: 0, recurrence: 0, errors: [],
  },
  {
    id: 'r14', ref: 'A5065021L', title: 'LABEX results upload intermittently rejected – no root cause recorded',
    source: 'HDA Ticketing', type: 'Incident', kind: 'historical', application: 'LABEX', module: 'Integration gateway',
    environment: 'Production', location: 'Lyon lab', ownerGroup: 'Integration Team', priority: 'P3 – Medium',
    category: 'Data sync', status: 'Open', created: '2026-10-08', updated: '2026-10-20', approval: 'Historical – not approved',
    excerpt: 'Measurement results upload rejected roughly 3% of the time with a schema validation error. Retrying usually succeeds.',
    rootCause: '', resolution: '', similarity: 0, recurrence: 2, errors: ['Schema validation failed: field "axis"'],
  },
  {
    id: 'r15', ref: 'A5062280L', title: 'Rx.Net sign-in loop for lab users after certificate renewal',
    source: 'HDA Ticketing', type: 'Incident', kind: 'historical', application: 'Rx.Net', module: 'Auth service',
    environment: 'Production', location: 'Manaus lab', ownerGroup: 'Service Desk L1', priority: 'P2 – High',
    category: 'Authentication', status: 'Open', created: '2026-10-16', updated: '2026-10-22', approval: 'Historical – not approved',
    excerpt: 'Users redirected back to the sign-in page repeatedly. Started after the identity certificate renewal.',
    rootCause: '', resolution: '', similarity: 0, recurrence: 1, errors: ['AADSTS50011 reply URL mismatch'],
  },
  {
    id: 'r16', ref: 'BUG-1907', title: 'EOLP order launch retries create duplicate jobs in manufacturing labs',
    source: 'Azure DevOps', type: 'Bug', kind: 'devwork', application: 'EOLP', module: 'Order launch',
    environment: 'Production', location: 'Bangkok lab', ownerGroup: 'Platform Engineering', priority: 'P1 – Critical',
    category: 'Order launch', status: 'In progress', created: '2026-10-11', updated: '2026-10-24', approval: 'Work item – not knowledge',
    excerpt: 'When the first launch call times out, the retry creates a second job. Labs see duplicate lens pairs.',
    rootCause: 'Retry is not idempotent.', resolution: 'Idempotency key being added.', similarity: 0, recurrence: 3, errors: ['Duplicate job id'],
  },
];

// Hand-authored answer for the demonstration query. Deterministic.
export const DEMO_QUERY = 'RxCNC connections work after a server restart but begin timing out again after a few hours.';

export const DEMO_ANSWER = {
  summary: [
    { t: 'RxCNC connectivity temporarily recovers after the server or service is restarted, but timeouts return after several hours.', cite: ['r1', 'r5'] },
    { t: ' The pattern suggests that a resource, connection, session, or dependency may degrade or accumulate over time.', cite: ['r2', 'r6'] },
  ],
  steps: [
    { t: 'Check active and stale socket connections.', d: 'Count ESTABLISHED and CLOSE_WAIT sockets on the RxCNC host towards the dispatcher port.', cite: ['r3', 'r6'] },
    { t: 'Review application connection-pool usage.', d: 'Compare active sessions with the pool maximum (512 in the referenced bug).', cite: ['r2'] },
    { t: 'Compare resource consumption before and after restart.', d: 'Memory, handles and threads for the RxCNC service.', cite: ['r3'] },
    { t: 'Review logs during the period when timeouts begin.', d: 'Look for pool-exhausted and socket-timeout messages.', cite: ['r1', 'r2'] },
    { t: 'Check for unreleased sessions or connection accumulation.', d: 'Aborted jobs are a known suspect.', cite: ['r2'] },
    { t: 'Correlate the issue with dependent services and scheduled activity.', d: 'License service, SQL instance and shift-change batch loads.', cite: ['r3', 'r5'] },
    { t: 'Validate findings before applying a previous resolution.', d: 'Historical fixes have not been approved as reusable knowledge.', cite: [] },
  ],
  evidence: ['r1', 'r2', 'r3'],
  related: ['r5', 'r6', 'r7', 'r4'],
  confidence: 'Medium',
  confidenceWhy: 'Multiple records describe similar symptoms, but the available evidence does not confirm a permanent root cause.',
  warning: 'Restarting the server or service appears to provide temporary recovery. Do not present restart as the permanent resolution unless the underlying cause has been validated.',
  lastEvidence: '2026-10-14',
};

export const SUGGESTED_PROMPTS = [
  'Have we seen this RxCNC connection timeout before?',
  'Find incidents where restarting a service only provided temporary recovery.',
  'What are the most common order-launch failures?',
  'Show previous solutions for API timeout incidents.',
  'Find related HDA tickets and Azure DevOps bugs.',
  'What recurring issues affected manufacturing labs?',
  'Summarize the known fixes for print-queue failures.',
  'Show unresolved incidents without a documented root cause.',
];

export const SEARCH_HISTORY = [
  { q: 'LABEX schema validation failed axis', when: 'Today, 09:12' },
  { q: 'Print queue Bangkok spooler stopped', when: 'Yesterday, 16:40' },
  { q: 'ECM API 504 month-end batch', when: 'Oct 23' },
  { q: 'Rx.Net sign-in loop certificate', when: 'Oct 22' },
];

export const RECENT_ITEMS = ['r3', 'r12', 'r9', 'r14'];

// Similar Issues page — ranked historical matches for the current issue.
export const SIMILAR_ISSUES = [
  {
    id: 's1', recordId: 'r1', why: ['Same application and module', 'Restart gives temporary recovery', 'Same timeout error text', 'Degrades after 5–6 hours'],
    shared: ['Timeouts return hours after restart', 'Connection timed out when sending jobs', 'Production, surfacing area'],
    different: ['Earlier ticket did not record socket counts'],
    envDiff: 'Same environment (Production). Different RxCNC build: 7.4.2 then, 7.5.0 now.',
    reuseRisk: 'High', reuseNote: 'Restart only masks the symptom. Reusing it will not prevent recurrence.',
    validation: ['Confirm CLOSE_WAIT growth rate', 'Capture pool metrics before restart', 'Agree a permanent fix owner'],
  },
  {
    id: 's2', recordId: 'r2', why: ['Pool exhaustion explains delayed onset', 'Same timeout error', 'Linked to A5058563L'],
    shared: ['Sessions accumulate over ~4 hours', 'New requests wait then time out'],
    different: ['Reproduced in pre-production load test, not production', 'Trigger is job abort'],
    envDiff: 'Pre-production with synthetic load. Production abort rate unknown.',
    reuseRisk: 'Medium', reuseNote: 'Fix is not released. No validated workaround yet.',
    validation: ['Check production job-abort rate', 'Compare session count to pool max', 'Confirm build includes pool library 3.8'],
  },
  {
    id: 's3', recordId: 'r6', why: ['CLOSE_WAIT growth on the same host', 'Growth rate fits onset time'],
    shared: ['Socket accumulation towards dispatcher port'],
    different: ['Chat observation, no ticket or resolution'],
    envDiff: 'Same host (RXCNC-APP02).', reuseRisk: 'Low', reuseNote: 'Observation only. Nothing to reuse yet.',
    validation: ['Repeat netstat sample hourly', 'Attach results to the investigation'],
  },
  {
    id: 's4', recordId: 'r4', why: ['Same application', 'Connection failures to RxCNC'],
    shared: ['Jobs cannot reach RxCNC'],
    different: ['Immediate failure, not delayed', 'Connection refused instead of timeout', 'Started after patching'],
    envDiff: 'Lyon lab, after Windows patch window.', reuseRisk: 'Low', reuseNote: 'Different failure mode. Firewall fix unlikely to apply.',
    validation: ['Check port 5021 rule is present', 'Rule out recent patching'],
  },
  {
    id: 's5', recordId: 'r8', why: ['Timeout pattern under load', 'Gateway involved'],
    shared: ['Timeouts under sustained load'],
    different: ['Different application (Order Import)', 'HTTP 504 rather than socket timeout', 'Month-end only'],
    envDiff: 'Singapore hub integration gateway.', reuseRisk: 'Medium', reuseNote: 'Raising timeouts hides saturation. Approved guidance caps it at 60 s.',
    validation: ['Confirm whether RxCNC traffic passes the gateway'],
  },
];

export const CURRENT_ISSUE = {
  title: 'RxCNC connections time out again a few hours after restart',
  application: 'RxCNC', environment: 'Production', location: 'Dallas lab',
  symptoms: ['Timeouts return hours after restart', 'Connection timed out when sending jobs', 'CLOSE_WAIT sockets above 400'],
  errors: ['ERR_CONN_TIMEOUT', 'Socket read timed out after 30000 ms'],
  build: 'RxCNC 7.5.0',
};

// Connectors
export const CONNECTOR_TYPES = [
  { key: 'sharepoint', name: 'SharePoint', cat: 'Documents', desc: 'Sites, libraries and lists', auth: ['Microsoft Entra ID', 'Managed identity'] },
  { key: 'onedrive', name: 'OneDrive', cat: 'Documents', desc: 'Personal and shared files', auth: ['Microsoft Entra ID', 'OAuth'] },
  { key: 'hda', name: 'HDA Ticketing', cat: 'Ticketing', desc: 'Incidents, requests and problems', auth: ['Service account', 'API key', 'OAuth'] },
  { key: 'ado', name: 'Azure DevOps', cat: 'Engineering', desc: 'Bugs, work items, repos and wikis', auth: ['Personal access token', 'Microsoft Entra ID', 'Managed identity'] },
  { key: 'outlook', name: 'Microsoft Outlook', cat: 'Communication', desc: 'Mailboxes and shared mailboxes', auth: ['Microsoft Entra ID', 'Managed identity'] },
  { key: 'teams', name: 'Microsoft Teams', cat: 'Communication', desc: 'Channels and chat threads', auth: ['Microsoft Entra ID'] },
  { key: 'confluence', name: 'Confluence', cat: 'Documents', desc: 'Spaces and pages', auth: ['OAuth', 'API key'] },
  { key: 'sql', name: 'SQL Database', cat: 'Data', desc: 'Tables and views', auth: ['Managed identity', 'Service account'] },
  { key: 'rest', name: 'REST API', cat: 'Custom', desc: 'Any JSON REST endpoint', auth: ['API key', 'OAuth', 'Custom headers'] },
  { key: 'mcp', name: 'Custom MCP Connector', cat: 'Custom', desc: 'Model Context Protocol server', auth: ['OAuth', 'API key', 'Custom headers'] },
];

export const CONNECTORS = [
  { id: 'c1', type: 'sharepoint', name: 'SharePoint – Lab Systems KB', status: 'Connected', lastSync: 'Today, 10:05', records: 4812, health: 99, owner: 'Knowledge Management', failed: 0, duration: '6 min', next: 'Today, 11:05' },
  { id: 'c2', type: 'onedrive', name: 'OneDrive – Support runbooks', status: 'Connected', lastSync: 'Today, 09:30', records: 1260, health: 97, owner: 'App Support – Lab Systems', failed: 3, duration: '2 min', next: 'Today, 13:30' },
  { id: 'c3', type: 'hda', name: 'HDA Ticketing', status: 'Syncing', lastSync: 'Today, 10:20', records: 182340, health: 96, owner: 'Service Desk L1', failed: 12, duration: '18 min', next: 'Continuous' },
  { id: 'c4', type: 'ado', name: 'Azure DevOps – Lab platforms', status: 'Connected', lastSync: 'Today, 10:12', records: 23918, health: 98, owner: 'Platform Engineering', failed: 0, duration: '9 min', next: 'Today, 10:42' },
  { id: 'c5', type: 'outlook', name: 'Outlook – Lab support mailbox', status: 'Action required', lastSync: 'Oct 25, 18:02', records: 38120, health: 71, owner: 'App Support – Order Flow', failed: 214, duration: '—', next: 'Paused until re-authenticated', issue: 'Authentication expired on Oct 25. Re-authenticate to resume sync.' },
  { id: 'c6', type: 'teams', name: 'Teams – Lab Systems channels', status: 'Paused', lastSync: 'Oct 20, 08:00', records: 9402, health: 90, owner: 'Infrastructure Ops', failed: 0, duration: '4 min', next: 'Paused' },
  { id: 'c7', type: 'confluence', name: 'Confluence – Integration space', status: 'Connected', lastSync: 'Today, 07:45', records: 2214, health: 100, owner: 'Integration Team', failed: 0, duration: '3 min', next: 'Tomorrow, 07:45' },
  { id: 'c8', type: 'sql', name: 'SQL – Lab KPI warehouse', status: 'Failed', lastSync: 'Oct 26, 23:00', records: 0, health: 0, owner: 'Platform Engineering', failed: 1, duration: '—', next: 'Retry at 12:00', issue: 'Connection test failed: login timeout to sql-labkpi (demonstration host).' },
  { id: 'c9', type: 'rest', name: 'REST API – Service monitoring', status: 'Not configured', lastSync: 'Never', records: 0, health: null, owner: 'Unassigned', failed: 0, duration: '—', next: '—' },
  { id: 'c10', type: 'mcp', name: 'Custom MCP – Lab equipment telemetry', status: 'Not configured', lastSync: 'Never', records: 0, health: null, owner: 'Unassigned', failed: 0, duration: '—', next: '—' },
];

export const SYNORA_FIELDS = ['Source ID', 'Title', 'Content', 'Application', 'Module', 'Environment', 'Location', 'Category', 'Owner group', 'Priority', 'Status', 'Root cause', 'Resolution', 'Created date', 'Updated date', 'Source URL'];

export const SOURCE_FIELDS = {
  hda: ['ticket_number', 'short_description', 'description', 'cmdb_ci', 'subcategory', 'u_environment', 'location', 'category', 'assignment_group', 'priority', 'state', 'u_root_cause', 'close_notes', 'opened_at', 'sys_updated_on', 'link'],
  ado: ['System.Id', 'System.Title', 'Microsoft.VSTS.TCM.ReproSteps', 'Custom.Application', 'System.AreaPath', 'Custom.Environment', 'Custom.Site', 'System.WorkItemType', 'System.AssignedTo.Team', 'Microsoft.VSTS.Common.Priority', 'System.State', 'Custom.RootCause', 'Custom.Resolution', 'System.CreatedDate', 'System.ChangedDate', '_links.html'],
  default: ['id', 'title', 'body', 'application', 'module', 'environment', 'location', 'category', 'owner', 'priority', 'status', 'root_cause', 'resolution', 'created', 'modified', 'url'],
};

export const SYNC_HISTORY = [
  { when: 'Today, 10:05', type: 'Incremental', result: 'Succeeded', added: 42, updated: 118, failed: 0, duration: '6 min' },
  { when: 'Today, 09:05', type: 'Incremental', result: 'Succeeded', added: 17, updated: 63, failed: 0, duration: '5 min' },
  { when: 'Today, 08:05', type: 'Incremental', result: 'Partial', added: 8, updated: 40, failed: 3, duration: '7 min' },
  { when: 'Oct 26, 23:00', type: 'Full', result: 'Succeeded', added: 0, updated: 4790, failed: 0, duration: '41 min' },
];

export const ERROR_LOG = [
  { when: 'Today, 08:11', code: 'PERM_403', msg: 'Item skipped: no read permission for service identity on /sites/LabSys/Restricted.' },
  { when: 'Today, 08:09', code: 'SIZE_LIMIT', msg: 'Attachment larger than 50 MB skipped: RxCNC_trace_full.zip.' },
  { when: 'Today, 08:07', code: 'PARSE_ERR', msg: 'Unsupported file type skipped: legacy .wps document.' },
];

// Notifications
export const NOTIFICATIONS = [
  { id: 'n1', title: 'Outlook connector needs re-authentication', body: 'Lab support mailbox sync paused on Oct 25.', when: '2 h ago', page: 'sources', unread: true },
  { id: 'n2', title: 'New recurring issue group detected', body: 'RxCNC timeouts after restart — 4 incidents in 60 days.', when: '5 h ago', page: 'similar', unread: true },
  { id: 'n3', title: 'Knowledge candidate ready for review', body: 'RxCNC connection-pool exhaustion: interim checks.', when: 'Yesterday', page: 'admin', unread: true },
  { id: 'n4', title: 'SQL connector sync failed', body: 'Lab KPI warehouse: login timeout.', when: 'Yesterday', page: 'sources', unread: false },
];

// Saved
export const SAVED_INIT = [
  { id: 'sv1', kind: 'search', name: 'Print queue failures – Bangkok', query: 'Summarize the known fixes for print-queue failures.', tags: ['printing'], when: 'Oct 24', collection: null },
  { id: 'sv2', kind: 'search', name: 'Unresolved without root cause', query: 'Show unresolved incidents without a documented root cause.', tags: ['knowledge gaps'], when: 'Oct 21', collection: 'col1' },
  { id: 'sv3', kind: 'answer', name: 'Order-launch failure causes', query: 'What are the most common order-launch failures?', tags: ['order launch', 'EOLP'], when: 'Oct 19', collection: null },
  { id: 'sv4', kind: 'ticket', name: 'A5058563L – RxCNC restart recovery', recordId: 'r1', tags: ['RxCNC'], when: 'Oct 26', collection: 'col1' },
  { id: 'sv5', kind: 'ticket', name: 'BUG-1907 – Duplicate jobs on retry', recordId: 'r16', tags: ['EOLP', 'critical'], when: 'Oct 24', collection: null },
  { id: 'sv6', kind: 'document', name: 'RxCNC Connectivity Troubleshooting Guide', recordId: 'r3', tags: ['RxCNC', 'approved'], when: 'Oct 22', collection: 'col1' },
  { id: 'sv7', kind: 'document', name: 'ECM API timeout handling', recordId: 'r9', tags: ['API'], when: 'Oct 12', collection: null },
];
export const COLLECTIONS_INIT = [
  { id: 'col1', name: 'RxCNC timeout investigation', note: 'Dallas lab, recurring after restart' },
];

// Administration
export const ROLES = ['Search User', 'Support Engineer', 'Connector Owner', 'Knowledge Manager', 'Administrator', 'Auditor'];
export const USERS = [
  { id: 'u1', name: 'Alex Morgan', email: 'alex.morgan@demo.synora', role: 'Administrator', group: 'Platform Engineering', last: 'Now' },
  { id: 'u2', name: 'Priya Natarajan', email: 'priya.n@demo.synora', role: 'Knowledge Manager', group: 'Knowledge Management', last: 'Today' },
  { id: 'u3', name: 'Tomás Ferreira', email: 'tomas.f@demo.synora', role: 'Support Engineer', group: 'App Support – Lab Systems', last: 'Today' },
  { id: 'u4', name: 'Mei Lin Ong', email: 'meilin.o@demo.synora', role: 'Connector Owner', group: 'Integration Team', last: 'Yesterday' },
  { id: 'u5', name: 'Jordan Blake', email: 'jordan.b@demo.synora', role: 'Search User', group: 'Service Desk L1', last: 'Oct 24' },
  { id: 'u6', name: 'Sam Okafor', email: 'sam.o@demo.synora', role: 'Auditor', group: 'Risk & Compliance', last: 'Oct 20' },
];

export const AUDIT = [
  { when: 'Today, 10:21', who: 'Alex Morgan', action: 'Updated AI configuration', target: 'Confidence threshold 0.55 → 0.60', cat: 'Configuration' },
  { when: 'Today, 09:58', who: 'Priya Natarajan', action: 'Requested changes', target: 'Candidate KC-031', cat: 'Knowledge' },
  { when: 'Today, 09:14', who: 'Tomás Ferreira', action: 'Opened source record', target: 'A5058563L', cat: 'Access' },
  { when: 'Today, 08:40', who: 'Mei Lin Ong', action: 'Ran manual sync', target: 'Confluence – Integration space', cat: 'Connector' },
  { when: 'Yesterday, 17:02', who: 'System', action: 'Permission sync completed', target: 'SharePoint – Lab Systems KB', cat: 'Security' },
  { when: 'Yesterday, 15:30', who: 'Sam Okafor', action: 'Exported audit log', target: 'Oct 1 – Oct 25', cat: 'Access' },
  { when: 'Oct 25, 18:02', who: 'System', action: 'Authentication expired', target: 'Outlook – Lab support mailbox', cat: 'Connector' },
];

export const KNOWLEDGE_CANDIDATE = {
  id: 'KC-034',
  title: 'RxCNC timeouts after restart: check connection-pool exhaustion before restarting',
  sources: ['r1', 'r2', 'r3', 'r6'],
  draft: '1. Capture CLOSE_WAIT socket count and active pool sessions on the RxCNC host.\n2. If sessions exceed 80% of the pool maximum, record job-abort counts for the last 4 hours.\n3. Escalate to Platform Engineering with BUG-1842 referenced.\n4. A service restart may be used as a temporary measure only, with the captured metrics attached to the incident.',
  reviewer: 'Priya Natarajan',
  checklist: ['Steps reproduced on a test host', 'Sources cited for every step', 'Restart stated as temporary', 'Owner group confirmed', 'No personal data in content'],
};

// Analytics — deterministic synthetic tickets (seeded generator, no randomness at runtime).
const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
export const ANALYTICS_MONTHS = MONTHS;
export const ROOT_CAUSES = ['Resource exhaustion', 'Configuration change', 'Data quality', 'Integration timeout', 'Infrastructure', 'Not documented'];
export const RECURRING_GROUPS = ['RxCNC timeout after restart', 'Print spooler hang', 'Order launch – missing catalogue', 'ECM API 504 at month-end', 'LABEX schema rejection', 'Duplicate jobs on retry', 'Sign-in loop after cert renewal'];

function lcg(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function pick(r, arr, weights) {
  if (!weights) return arr[Math.floor(r() * arr.length)];
  const total = weights.reduce((a, b) => a + b, 0); let x = r() * total;
  for (let i = 0; i < arr.length; i++) { x -= weights[i]; if (x <= 0) return arr[i]; }
  return arr[arr.length - 1];
}
export const TICKETS = (() => {
  const r = lcg(20261027); const out = [];
  const sources = ['HDA Ticketing', 'Azure DevOps', 'Outlook', 'Teams', 'SharePoint'];
  const groupApp = { 'RxCNC timeout after restart': 'RxCNC', 'Print spooler hang': 'Print queues', 'Order launch – missing catalogue': 'EOLP', 'ECM API 504 at month-end': 'ECM API', 'LABEX schema rejection': 'LABEX', 'Duplicate jobs on retry': 'EOLP', 'Sign-in loop after cert renewal': 'Rx.Net' };
  for (let i = 0; i < 640; i++) {
    const m = Math.min(11, Math.floor(r() * 12 + (r() > 0.7 ? 2 : 0)));
    const recurring = r() < 0.42 ? pick(r, RECURRING_GROUPS, [9, 7, 6, 4, 3, 3, 2]) : null;
    const application = recurring ? groupApp[recurring] : pick(r, APPLICATIONS, [10, 7, 6, 6, 8, 5, 6, 5, 7, 3]);
    const rootCause = pick(r, ROOT_CAUSES, [5, 6, 4, 5, 3, 5]);
    const status = pick(r, ['Open', 'In progress', 'Resolved', 'Closed'], [2, 2, 3, 8]);
    out.push({
      id: 't' + i, ref: 'A50' + String(40000 + i * 37).slice(0, 5) + 'L', month: m,
      source: pick(r, sources, [12, 4, 3, 2, 1]), application,
      location: pick(r, LOCATIONS, [6, 5, 5, 4, 2, 2]), ownerGroup: pick(r, OWNER_GROUPS, [6, 5, 4, 4, 5, 3]),
      priority: pick(r, PRIORITIES, [1, 4, 8, 4]), category: pick(r, CATEGORIES, [6, 5, 5, 4, 3, 2, 3, 2]),
      status, rootCause, recurring,
      solution: rootCause === 'Not documented' ? false : r() > 0.18,
      reuse: pick(r, ['Reused approved knowledge', 'Reused historical fix', 'New resolution', 'No resolution'], [3, 4, 5, 2]),
    });
  }
  return out;
})();

export const NO_ANSWER_SEARCHES = [
  { q: 'Tristar label template v3.3 barcode offset', count: 14, app: 'Print queues' },
  { q: 'VisionStar coating machine handshake', count: 11, app: 'VisionStar' },
  { q: 'LABEX axis schema change owner', count: 9, app: 'LABEX' },
  { q: 'Rx.Net reply URL after cert renewal', count: 7, app: 'Rx.Net' },
  { q: 'Manaus generator firmware compatibility', count: 5, app: 'RxCNC' },
];

export const SYSTEM_HEALTH = [
  { name: 'Search API', status: 'Operational', latency: '182 ms p95' },
  { name: 'Retrieval index', status: 'Operational', latency: '64 ms p95' },
  { name: 'Answer generation', status: 'Operational', latency: '3.4 s p95' },
  { name: 'Permission sync', status: 'Degraded', latency: 'Outlook source behind by 40 h' },
  { name: 'Connector workers', status: 'Operational', latency: '7 of 8 healthy' },
  { name: 'Audit log store', status: 'Operational', latency: 'Retention 400 days' },
];

export const DEMO_USER = { name: 'Alex Morgan', initials: 'AM', role: 'Administrator', group: 'Platform Engineering', email: 'alex.morgan@demo.synora' };

export const recordById = (id) => RECORDS.find((r) => r.id === id);
export const connectorType = (key) => CONNECTOR_TYPES.find((t) => t.key === key);

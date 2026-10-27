// Deterministic demonstration "search engine". Same input always produces the same output.
import { RECORDS, DEMO_ANSWER, recordById } from './data.js';

const TODAY = new Date('2026-10-27');
const STOP = new Set('a an the and or of to in on for with we have has this that these those is are was were be been after before again what which show find me our any all about from by do does did how why when where it its as at but begin few hours work works'.split(' '));

const FIELD = { source: 'source', application: 'application', module: 'module', environment: 'environment', location: 'location', ownerGroup: 'ownerGroup', priority: 'priority', category: 'category', status: 'status', recordType: 'type' };

export function applyFilters(records, filters, sources) {
  return records.filter((r) => {
    if (sources && sources.length && !sources.includes(r.source === 'Knowledge base' ? 'Knowledge base' : r.source)) return false;
    for (const key of Object.keys(FIELD)) {
      const vals = filters[key];
      if (!vals || !vals.length) continue;
      const v = r[FIELD[key]];
      if (key === 'location' && v === 'All locations') continue;
      if (!vals.includes(v)) return false;
    }
    if (filters.date && filters.date !== 'any') {
      const days = { '30': 30, '90': 90, '365': 365 }[filters.date];
      if ((TODAY - new Date(r.updated)) / 864e5 > days) return false;
    }
    return true;
  });
}

const ids = (...a) => a;

// Hand-authored intents for the suggested prompts; anything else falls back to keyword matching.
const INTENTS = [
  {
    key: 'rxcnc', test: (q) => /rxcnc/.test(q) && /(time|timing|timeout|restart|connect)/.test(q),
    demo: true,
  },
  {
    key: 'restart', test: (q) => /restart/.test(q) && /(temporar|only|again|recover)/.test(q),
    records: ids('r1', 'r5', 'r12', 'r2'),
    summary: [
      { t: 'Three records describe a restart that restored service without removing the cause.', cite: ['r1', 'r12'] },
      { t: ' In the RxCNC cases the problem returned within hours, which points to something accumulating over time.', cite: ['r5', 'r2'] },
    ],
    steps: [
      { t: 'Treat a restart as a temporary measure.', d: 'Record it as a workaround, not a resolution.', cite: ['r1'] },
      { t: 'Capture resource and connection metrics before restarting.', d: 'Without them the cause cannot be confirmed later.', cite: ['r5'] },
      { t: 'Link recurring tickets to one problem record.', d: 'Four RxCNC tickets share the same pattern.', cite: ['r1', 'r2'] },
      { t: 'Validate findings before applying a previous resolution.', d: '', cite: [] },
    ],
    confidence: 'Medium', why: 'The pattern is consistent across records, but no permanent fix has been approved.',
    warning: 'A restart that restores service does not prove the cause is fixed. Validate before closing similar incidents.',
    hypotheses: [['Resource or session accumulation', 'Supported', ['r2', 'r5']], ['Corrupted queued work', 'Possible for print queues', ['r12']]],
  },
  {
    key: 'orderlaunch', test: (q) => /order.?launch/.test(q),
    records: ids('r11', 'r10', 'r16'),
    summary: [
      { t: 'Approved guidance lists missing catalogue data as the most frequent cause of order-launch failures (38%), followed by invalid frame tracing (24%) and credit holds (17%).', cite: ['r11'] },
      { t: ' Recent incidents match this: a disabled catalogue sync at Manaus and duplicate jobs from non-idempotent retries.', cite: ['r10', 'r16'] },
    ],
    steps: [
      { t: 'Check the product catalogue sync ran after the last release.', d: '', cite: ['r11', 'r10'] },
      { t: 'Validate the frame tracing on the failing orders.', d: '', cite: ['r11'] },
      { t: 'Confirm the customer is not on credit hold.', d: '', cite: ['r11'] },
      { t: 'Check for duplicate jobs if launches were retried.', d: 'BUG-1907 is still open.', cite: ['r16'] },
    ],
    confidence: 'High', why: 'An approved knowledge article covers this and recent incidents agree with it.',
    hypotheses: [['Missing catalogue data', 'Supported', ['r11', 'r10']], ['Retry creates duplicates', 'Supported', ['r16']]],
  },
  {
    key: 'apitimeout', test: (q) => /api/.test(q) && /(time|504)/.test(q),
    records: ids('r9', 'r8', 'r2'),
    summary: [
      { t: 'API timeouts in the indexed records were resolved by splitting large batches and retrying idempotent requests with back-off.', cite: ['r8', 'r9'] },
      { t: ' Approved guidance caps gateway timeouts at 60 seconds without an architecture review.', cite: ['r9'] },
    ],
    steps: [
      { t: 'Check whether the call is part of a large batch.', d: 'Month-end batches took up to 48 s.', cite: ['r8'] },
      { t: 'Retry idempotent requests with 2, 4 and 8 second back-off.', d: '', cite: ['r9'] },
      { t: 'Split batches into chunks of about 500 items.', d: '', cite: ['r8'] },
      { t: 'Avoid raising timeouts above 60 s without review.', d: 'Longer timeouts can hide saturation.', cite: ['r9'] },
    ],
    confidence: 'High', why: 'An approved article and a closed incident agree on the fix.',
    hypotheses: [['Batch larger than gateway timeout', 'Supported', ['r8']], ['Downstream saturation', 'Possible', ['r2']]],
  },
  {
    key: 'hdaado', test: (q) => /hda/.test(q) && /(devops|ado|bug)/.test(q),
    records: ids('r1', 'r2', 'r16', 'r7'),
    summary: [
      { t: 'HDA incident A5058563L is linked to Azure DevOps bug BUG-1842, which is still under investigation.', cite: ['r1', 'r2'] },
      { t: ' BUG-1907 tracks duplicate jobs reported by labs, and work item WI-5520 adds a pool-saturation alert.', cite: ['r16', 'r7'] },
    ],
    steps: [
      { t: 'Review BUG-1842 before closing new RxCNC timeout tickets.', d: '', cite: ['r2'] },
      { t: 'Reference BUG-1907 on duplicate-job incidents.', d: '', cite: ['r16'] },
      { t: 'Follow WI-5520 for the monitoring alert release.', d: '', cite: ['r7'] },
    ],
    confidence: 'High', why: 'These links are recorded on the work items themselves.',
    hypotheses: [['Shared defect behind several tickets', 'Supported', ['r1', 'r2']]],
  },
  {
    key: 'recurringlabs', test: (q) => /recurr/.test(q) && /(lab|manufactur)/.test(q),
    records: ids('r12', 'r1', 'r16', 'r10', 'r14'),
    summary: [
      { t: 'Five recurring issues affected manufacturing labs in the last 12 months. Print spooler hangs at Bangkok recurred most often (5 times),', cite: ['r12'] },
      { t: ' followed by RxCNC timeouts after restart at Dallas (4) and duplicate jobs on retry (3).', cite: ['r1', 'r16'] },
    ],
    steps: [
      { t: 'Open a problem record for each group with three or more recurrences.', d: '', cite: ['r12', 'r1', 'r16'] },
      { t: 'Check whether approved knowledge exists for each group.', d: 'RxCNC and LABEX groups have none.', cite: ['r14'] },
      { t: 'Review recurrence after each fix is released.', d: '', cite: [] },
    ],
    confidence: 'Medium', why: 'Recurrence counts come from linked tickets; some links may be missing.',
    hypotheses: [['Template and spooler defects', 'Supported', ['r12']], ['Connection accumulation', 'Supported', ['r1', 'r2']]],
  },
  {
    key: 'print', test: (q) => /print/.test(q),
    records: ids('r13', 'r12'),
    summary: [
      { t: 'The approved recovery procedure is to stop the spooler, quarantine the spool files, restart it and re-send the last 20 jobs from Tristar.', cite: ['r13'] },
      { t: ' At Bangkok the hang was caused by a corrupted label template, fixed by rolling back to v3.1.', cite: ['r12'] },
    ],
    steps: [
      { t: 'Stop the spooler and move spool files to quarantine.', d: '', cite: ['r13'] },
      { t: 'Start the spooler and re-send the last 20 jobs.', d: '', cite: ['r13'] },
      { t: 'Check the Tristar label template version.', d: 'v3.2 produced corrupted spool files.', cite: ['r12'] },
    ],
    confidence: 'High', why: 'An approved procedure exists and matches the most recent incident.',
    hypotheses: [['Corrupted spool file', 'Supported', ['r12', 'r13']]],
  },
  {
    key: 'unresolved', test: (q) => /(unresolved|without .*root cause|no root cause|undocumented)/.test(q),
    records: ids('r14', 'r15', 'r2'),
    summary: [
      { t: 'Two open incidents have no documented root cause: LABEX upload rejections at Lyon and the Rx.Net sign-in loop at Manaus.', cite: ['r14', 'r15'] },
      { t: ' BUG-1842 records a suspected cause that has not been confirmed.', cite: ['r2'] },
    ],
    steps: [
      { t: 'Assign a root-cause owner to A5065021L and A5062280L.', d: '', cite: ['r14', 'r15'] },
      { t: 'Ask Knowledge Management to track both as knowledge gaps.', d: '', cite: [] },
    ],
    confidence: 'High', why: 'This is a direct listing of record fields, not an interpretation.',
    hypotheses: [['Schema change in LABEX payload', 'Not tested', ['r14']], ['Reply URL mismatch after renewal', 'Possible', ['r15']]],
  },
];

const DEMO_HYPOTHESES = [
  ['Connection-pool or session exhaustion', 'Most supported', ['r2', 'r6', 'r5']],
  ['Dependency degradation (license service, SQL)', 'Not yet tested', ['r3']],
  ['Network or firewall change', 'Unlikely – different failure mode', ['r4']],
];

function keywordHits(q, pool) {
  const toks = q.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length > 2 && !STOP.has(t));
  if (!toks.length) return [];
  return pool
    .map((r) => {
      const hay = (r.title + ' ' + r.excerpt + ' ' + r.application + ' ' + r.category + ' ' + r.ref).toLowerCase();
      const score = toks.reduce((a, t) => a + (hay.includes(t) ? 1 : 0), 0);
      return { r, score };
    })
    .filter((x) => x.score >= Math.min(2, toks.length))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}

const CONF_RANK = { Low: 1, Medium: 2, High: 3 };

export function runQuery(query, { filters, sources, scenario }) {
  const q = query.toLowerCase();
  const pool = applyFilters(RECORDS, filters, sources);
  const allowed = new Set(pool.map((r) => r.id));
  const filtered = pool.length < RECORDS.length;

  if (scenario === 'unavailable') return { state: 'unavailable' };
  if (scenario === 'insufficient') return { state: 'insufficient', reason: 'scenario' };

  const intent = INTENTS.find((i) => i.test(q));
  let res;
  if (intent && intent.demo) {
    res = {
      state: 'answer', intent: 'rxcnc', summary: DEMO_ANSWER.summary, steps: DEMO_ANSWER.steps,
      evidence: DEMO_ANSWER.evidence, related: DEMO_ANSWER.related, confidence: DEMO_ANSWER.confidence,
      why: DEMO_ANSWER.confidenceWhy, warning: DEMO_ANSWER.warning, hypotheses: DEMO_HYPOTHESES, lastEvidence: DEMO_ANSWER.lastEvidence,
    };
  } else if (intent) {
    res = {
      state: 'answer', intent: intent.key, summary: intent.summary, steps: intent.steps, evidence: intent.records.slice(0, 3),
      related: intent.records.slice(3), confidence: intent.confidence, why: intent.why, warning: intent.warning, hypotheses: intent.hypotheses,
    };
  } else {
    const hits = keywordHits(q, pool);
    if (hits.length < 2) return { state: 'insufficient', reason: filtered ? 'filters' : 'none', records: hits };
    const top = hits.slice(0, 3);
    res = {
      state: 'answer', intent: 'keyword',
      summary: [{ t: `Synora found ${hits.length} records that mention these terms, mostly about ${top[0].application} ${top[0].category.toLowerCase()}.`, cite: top.map((r) => r.id) },
        { t: ' No approved article answers the question directly, so treat this as a starting point.', cite: [] }],
      steps: top.filter((r) => r.resolution && r.resolution !== '—').map((r) => ({ t: r.resolution, d: `From ${r.ref}`, cite: [r.id] })).concat([{ t: 'Validate findings before applying a previous resolution.', d: '', cite: [] }]),
      evidence: top.map((r) => r.id), related: hits.slice(3, 7).map((r) => r.id), confidence: 'Low',
      why: 'Matches are based on shared terms only. No approved knowledge supports a specific answer.', hypotheses: top.filter((r) => r.rootCause && r.rootCause !== '—').map((r) => [r.rootCause, 'Possible', [r.id]]),
    };
  }

  // Remove evidence the user cannot see or has filtered out.
  const before = res.evidence.length + res.related.length;
  res.evidence = res.evidence.filter((id) => allowed.has(id));
  res.related = res.related.filter((id) => allowed.has(id));
  const strip = (parts) => parts.map((p) => ({ ...p, cite: p.cite.filter((id) => allowed.has(id)) }));
  res.summary = strip(res.summary);
  res.steps = strip(res.steps);
  res.hypotheses = (res.hypotheses || []).map(([h, s, c]) => [h, s, c.filter((id) => allowed.has(id))]);
  if (!res.evidence.length) return { state: 'insufficient', reason: filtered ? 'filters' : 'none' };
  res.partial = res.evidence.length + res.related.length < before;

  const minConf = filters.confidence && filters.confidence.length ? Math.min(...filters.confidence.map((c) => CONF_RANK[c])) : 0;
  if (minConf && CONF_RANK[res.confidence] < minConf) return { state: 'insufficient', reason: 'confidence', confidence: res.confidence };

  const all = res.evidence.concat(res.related).map(recordById);
  res.approvedCount = all.filter((r) => r.kind === 'approved').length;
  res.supporting = res.evidence.length;
  res.totalRelated = all.length;
  res.hasEmail = all.some((r) => r.source === 'Outlook');
  res.lastEvidence = res.lastEvidence || all.map((r) => r.updated).sort().pop();
  res.unauthorized = scenario === 'unauthorized';
  if (scenario === 'partial') res.partial = true;
  return res;
}

// For "Search Records" mode: plain ranked list.
export function searchRecords(query, { filters, sources }) {
  const pool = applyFilters(RECORDS, filters, sources);
  const q = query.toLowerCase();
  const intent = INTENTS.find((i) => i.test(q));
  let ids = [];
  if (intent && intent.demo) ids = DEMO_ANSWER.evidence.concat(DEMO_ANSWER.related);
  else if (intent) ids = intent.records;
  const set = new Set(ids);
  const extra = keywordHits(q, pool).filter((r) => !set.has(r.id));
  return ids.map(recordById).filter((r) => pool.includes(r)).concat(extra);
}

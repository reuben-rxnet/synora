// The connector SDK. Every source implements this interface; src/lib/ingest does the rest
// (normalising, change detection, chunking, embedding, permissions) the same way for all of them.

import type { SyncProgress } from "./progress";

export type RecordType = "incident" | "request" | "problem" | "bug" | "work_item" | "document" | "email" | "chat" | "knowledge_article";
/** reference: documentation (SharePoint files, wiki pages) that informs an answer but hasn't been approved as knowledge. */
export type EvidenceKind = "approved" | "historical" | "discussion" | "dev_work" | "reference";
export type Sensitivity = "public" | "internal" | "confidential" | "restricted";

/** One item as a connector delivers it, already mapped to Synora fields. */
export interface SourceItem {
  externalId: string;
  ref: string;
  /** Where the record lives, as people name it ("HDA Ticketing"). Defaults to the connector label. */
  sourceSystem?: string;
  recordType: RecordType;
  title: string;
  body: string;
  evidenceKind: EvidenceKind;
  approval?: "approved" | "historical" | "not_reviewed" | "draft";
  application?: string | null;
  module?: string | null;
  environment?: string | null;
  location?: string | null;
  category?: string | null;
  ownerGroup?: string | null;
  priority?: string | null;
  status?: string | null;
  rootCause?: string | null;
  resolution?: string | null;
  sourceUrl?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  sensitivity?: Sensitivity;
  /** A different space than the connector's own (one HDA connector feeds IT, HR, Retail…). */
  spaceKey?: string;
  /**
   * Who may see it, as principal keys. Connectors add source permissions (e.g. "group:hda:G815L");
   * ingest always adds the connector's space unless the item is restricted.
   */
  acl: string[];
  /** References to other records ("BUG-1842") that become RecordLinks once both exist. */
  links?: { ref: string; kind: "linked" | "duplicate" | "parent" | "mentions" }[];
  raw?: unknown;
}

export interface SyncContext {
  connectorId: string;
  spaceId: string;
  config: Record<string, unknown>;
  /** Reads a secret by its reference at the moment it is needed. Never logged. */
  secret: (name: string) => string | undefined;
  log: (message: string) => void;
}

export interface ChangeBatch {
  items: SourceItem[];
  /** Ids the source reports as deleted since the cursor. */
  deleted?: string[];
  /** Save after the batch is stored, so an interrupted sync resumes here. */
  cursor: string | null;
  done: boolean;
}

export interface TestResult { ok: boolean; level: "ok" | "warn" | "error"; message: string; sample?: number }

export interface Connector {
  type: string;
  label: string;
  testConnection(ctx: SyncContext): Promise<TestResult>;
  /** Yields batches of changes since the cursor (null = full sync). */
  fetchChanges(ctx: SyncContext, cursor: string | null): AsyncGenerator<ChangeBatch>;
  /** Group memberships the source knows about (e.g. HDA owner-group members), synced into Group/UserGroup. */
  fetchMemberships?(ctx: SyncContext): Promise<{ groupKey: string; groupName: string; memberLogins: string[] }[]>;
  /** Re-read memberships at most this often (full syncs always do). Unset: after every sync. */
  membershipSyncHours?: number;
  /** How far a sync has got, from the saved cursor alone (no source calls). Shown on the Sources page. */
  progress?(cursor: string | null): SyncProgress | null;
}

export class ConnectorError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message);
    this.name = "ConnectorError";
  }
}

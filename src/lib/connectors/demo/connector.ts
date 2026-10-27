// Demonstration connector: the prototype's records plus HR, Finance and Development content, so search,
// citations and department permissions can be tried without access to real systems. Every record is fictional.
import { principal } from "@/lib/access";
import type { ChangeBatch, Connector, SourceItem } from "../types";
import itRecords from "./it-records.json";
import departmentRecords from "./department-records.json";

type Fixture = Omit<SourceItem, "acl" | "createdAt" | "updatedAt" | "raw" | "sourceSystem"> & { source: string; createdAt?: string; updatedAt?: string; aclGroups?: string[] };

export function demoItems(): SourceItem[] {
  return ([...itRecords, ...departmentRecords] as Fixture[]).map(({ source, aclGroups, createdAt, updatedAt, ...f }) => ({
    ...f,
    sourceSystem: source,
    createdAt: createdAt ? new Date(`${createdAt}T09:00:00Z`) : null,
    updatedAt: updatedAt ? new Date(`${updatedAt}T09:00:00Z`) : null,
    acl: (aclGroups ?? []).map(principal.group),
    raw: { demo: true },
  }));
}

export const demoConnector: Connector = {
  type: "demo",
  label: "Demonstration data",
  async testConnection() {
    return { ok: true, level: "ok", message: `Demonstration data is available (${demoItems().length} fictional records).` };
  },
  async *fetchChanges(): AsyncGenerator<ChangeBatch> {
    yield { items: demoItems(), cursor: new Date().toISOString(), done: true };
  },
  async fetchMemberships() {
    return [{ groupKey: "hda:G-HROPS", groupName: "HR Operations", memberLogins: ["camille.durand@demo.synora"] }];
  },
};

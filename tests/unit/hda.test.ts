import { describe, expect, it } from "vitest";
import { activeGroups, fetchRows, loadMapping, nextPage, toItem, type HdaMapping } from "@/lib/connectors/hda/connector";
import { HdaClient, HdaError, type Projection } from "@/lib/connectors/hda/client";

const m = loadMapping("config/hda-mapping.json");
const row = { id: "A1", subject: "Printer down", description: "Scanner down", solution: "Replaced cable", objectType: "T10C", status: "S5", ownerGroupId: "G815L", ownerGroupName: "EUS", solvedAt: "2026-10-20T10:00:00Z" };

/** A stand-in for HDA: answers projections from a fixed set of tickets and rejects expressions listed in `bad`. */
function fakeClient(tickets: Record<string, Record<string, unknown>>, bad: string[] = []) {
  const calls: Projection[] = [];
  const client = {
    projectionUrlLength: (p: Projection) => 200 + JSON.stringify(p.columns).length * 2,
    projection: async (p: Projection) => {
      calls.push(p);
      if (p.columns.some((c) => bad.includes(c))) throw new HdaError("HDA error on /WSC/Projection: invalid column", { result: { code: "12" } });
      const data = Object.entries(tickets).map(([id, t]) => Object.fromEntries(p.names.map((n, i) => [n, n === "id" ? id : t[p.columns[i]!] ?? null])));
      return { data };
    },
  };
  return { client: client as unknown as HdaClient, calls };
}

describe("HDA extended mapping", () => {
  it("maps every extended field and keeps people's names out of the searchable text", () => {
    const item = toItem({ ...row, ticketType: "Incident", applicationName: "RX.NET", contact: "Jane Example", escalated: true, closedAt: "/Date(1760954400000)/" }, m, "https://hda.example")!;
    expect(item.body).toContain("Ticket type: Incident");
    expect(item.body).toContain("Escalated: Yes");
    expect(item.body).not.toContain("Jane Example");
    expect(item.application).toBe("RX.NET");
    const fields = (item.raw as { fields: { key: string; value: string; person?: boolean }[] }).fields;
    expect(fields.find((f) => f.key === "contact")).toMatchObject({ value: "Jane Example", person: true });
    expect(fields.find((f) => f.key === "closedAt")?.value).toBe("2025-10-20T10:00:00.000Z");
    expect((item.raw as { ownerGroupId: string }).ownerGroupId).toBe("G815L");
  });
  it("links a parent ticket", () => {
    expect(toItem({ ...row, parentTicket: "A0" }, m, "x")!.links).toContainEqual({ ref: "A0", kind: "parent" });
  });
  it("leaves fields of never-indexed ticket types out of the mapping", () => {
    expect(m.fields.some((f) => /^(SEC|EL13|EL144|EL26)/.test(f.expr))).toBe(false);
  });
});

describe("HDA column splitting", () => {
  const small: HdaMapping = { ...m, maxUrlLength: 400 };
  const tickets = { A1: { ID: "A1", Subject: "s", TicketCode: "TC1", Tag: "t1", "TicketType.Description": "Incident", TicketTypeID: "T10C" } };

  it("keeps every call under the URL limit and merges the parts by ticket id", async () => {
    const { client, calls } = fakeClient(tickets);
    const rows = await fetchRows(client, small, { entity: "Incident", limit: 5 });
    expect(calls.length).toBeGreaterThan(2);
    // Each extra call carries the id plus fields, under the limit unless a single field alone is longer.
    expect(calls.slice(1).every((c) => c.columns[0] === "ID" && (client.projectionUrlLength(c) <= 400 || c.columns.length === 2))).toBe(true);
    expect(rows[0]).toMatchObject({ subject: "s", ticketCode: "TC1", tag: "t1", ticketType: "Incident" });
  });
  it("uses the fallback, or drops the field, when HDA rejects an expression", async () => {
    const { client } = fakeClient(tickets, ["TicketType.Description", "Contact.FullName"]);
    const dropped = new Set<string>();
    const rows = await fetchRows(client, small, { entity: "Incident", limit: 5 }, dropped);
    expect(rows[0]!.ticketType).toBe("T10C");
    expect([...dropped]).toEqual(["Contact (Contact.FullName)"]);
  });
});

describe("HDA error pages", () => {
  it("doesn't mistake HDA being unavailable for a rejected column", async () => {
    const { client } = fakeClient({ A1: { ID: "A1" } });
    let calls = 0;
    const flaky = Object.assign(Object.create(Object.getPrototypeOf(client)), client, {
      projection: async (p: Projection) => {
        if (++calls === 2) throw new HdaError("HDA returned a non-JSON answer (404)", { status: 404, errorPage: true });
        return client.projection(p);
      },
    }) as HdaClient;
    const dropped = new Set<string>();
    await expect(fetchRows(flaky, { ...m, maxUrlLength: 400 }, { entity: "Incident", limit: 5 }, dropped)).rejects.toThrow("non-JSON");
    expect(dropped.size).toBe(0);
  });
});

describe("HDA keyset paging", () => {
  const at = (iso: string) => ({ solvedAt: iso });
  it("moves the date forward and skips the rows of the last second", () => {
    const r = nextPage(new Date("2026-01-01T00:00:00Z"), 0, [at("2026-01-02T00:00:00Z"), at("2026-01-03T10:00:00Z"), at("2026-01-03T10:00:00Z")]);
    expect(r).toEqual({ since: new Date("2026-01-03T10:00:00Z"), skip: 2 });
  });
  it("keeps paging inside one second when a whole page was solved at the same time", () => {
    const since = new Date("2026-01-03T10:00:00Z");
    expect(nextPage(since, 2, [at("2026-01-03T10:00:00Z"), at("2026-01-03T10:00:00Z")])).toEqual({ since, skip: 4 });
  });
});

describe("HDA owner groups", () => {
  it("reads only well-formed active groups from the connector config", () => {
    expect(activeGroups({ ownerGroups: [{ id: "G815L", name: "RxIT" }, null, { name: "x" }] })).toEqual([{ id: "G815L", name: "RxIT" }]);
    expect(activeGroups({})).toEqual([]);
  });
});

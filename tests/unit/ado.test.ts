import { describe, expect, it } from "vitest";
import { loadAdoMapping, markdownText, pageQuery, parseCursor, parseWikiState, toWikiPage, toWorkItem, wikiReadPlan } from "@/lib/connectors/ado/connector";
import type { AdoField, AdoWorkItem } from "@/lib/connectors/ado/client";

const m = loadAdoMapping("config/ado-mapping.json");
const meta = new Map<string, AdoField>([
  ["System.Title", { referenceName: "System.Title", name: "Title", type: "string" }],
  ["System.WorkItemType", { referenceName: "System.WorkItemType", name: "Work Item Type", type: "string" }],
  ["System.State", { referenceName: "System.State", name: "State", type: "string" }],
  ["System.AreaPath", { referenceName: "System.AreaPath", name: "Area Path", type: "treePath" }],
  ["System.AssignedTo", { referenceName: "System.AssignedTo", name: "Assigned To", type: "string", isIdentity: true }],
  ["System.ChangedDate", { referenceName: "System.ChangedDate", name: "Changed Date", type: "dateTime" }],
  ["Microsoft.VSTS.TCM.ReproSteps", { referenceName: "Microsoft.VSTS.TCM.ReproSteps", name: "Repro Steps", type: "html" }],
  ["Custom.RootCauseCategory", { referenceName: "Custom.RootCauseCategory", name: "Root Cause Category", type: "string" }],
]);
const wi: AdoWorkItem = {
  id: 206985, rev: 4,
  fields: {
    "System.Title": "B_Lenses Picking – no error message", "System.WorkItemType": "Bug", "System.State": "New", "System.AreaPath": "Rx.Net - Platform\\Lenses",
    "System.AssignedTo": { displayName: "Jane Example", uniqueName: "jane@example.com" }, "System.ChangedDate": "2026-10-27T09:15:00.123Z",
    "Microsoft.VSTS.TCM.ReproSteps": "<div>Scan a data matrix from ticket A3415102L, see #206926</div>", "Microsoft.VSTS.Common.Severity": "2 - High",
    "Custom.RootCauseCategory": "Validation", "System.Rev": 4, "WEF_123_Kanban.Column": "New",
  },
  relations: [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/org/_apis/wit/workItems/206800" }],
};

describe("Azure DevOps mapping", () => {
  const item = toWorkItem(wi, m, meta, "https://dev.azure.com/ITRxSolutions/Rx.Net%20-%20Platform", [{ text: "<p>Root cause: missing validation</p>", createdDate: "2026-10-27T10:00:00Z" }]);

  it("maps a bug with its content, details and discussion", () => {
    expect(item).toMatchObject({ ref: "WI-206985", recordType: "bug", status: "New", category: "Bug", module: "Rx.Net - Platform\\Lenses", priority: "2 - High", evidenceKind: "dev_work" });
    expect(item.body).toContain("Repro steps:\nScan a data matrix");
    expect(item.body).toContain("Root Cause Category: Validation");
    expect(item.body).toContain("Discussion:\n[2026-10-27] Root cause: missing validation");
    expect(item.sourceUrl).toBe("https://dev.azure.com/ITRxSolutions/Rx.Net%20-%20Platform/_workitems/edit/206985");
  });
  it("shows people by name but keeps them out of the searchable text", () => {
    expect(item.body).not.toContain("Jane Example");
    const fields = (item.raw as { fields: { key: string; value: string; person?: boolean }[] }).fields;
    expect(fields.find((f) => f.key === "System.AssignedTo")).toMatchObject({ value: "Jane Example", person: true });
    expect(JSON.stringify(item.raw)).not.toContain("jane@example.com");
  });
  it("drops bookkeeping fields", () => {
    const keys = (item.raw as { fields: { key: string }[] }).fields.map((f) => f.key);
    expect(keys).not.toContain("System.Rev");
    expect(keys).not.toContain("WEF_123_Kanban.Column");
  });
  it("links the parent, mentioned work items and HDA tickets", () => {
    expect(item.links).toEqual(expect.arrayContaining([
      { ref: "WI-206800", kind: "parent" }, { ref: "WI-206926", kind: "mentions" }, { ref: "A3415102L", kind: "mentions" },
    ]));
  });
});

describe("Azure DevOps paging", () => {
  it("pages by changed date, then id", () => {
    const q = pageQuery(m, { at: "2026-10-27T09:15:00.123Z", id: 206985 });
    expect(q).toContain("[System.ChangedDate] > '2026-10-27T09:15:00.123Z' OR ([System.ChangedDate] = '2026-10-27T09:15:00.123Z' AND [System.Id] > 206985)");
    expect(q).toContain("ORDER BY [System.ChangedDate] ASC, [System.Id] ASC");
  });
  it("escapes work item type names", () => {
    expect(pageQuery({ ...m, workItemTypes: ["O'Brien Bug"] }, { at: "x", id: 0 })).toContain("IN ('O''Brien Bug')");
  });
  it("starts from the lookback when there is no cursor, and reads old date cursors", () => {
    expect(parseCursor(JSON.stringify({ at: "2026-01-01T00:00:00.000Z", id: 5 }), 730)).toEqual({ at: "2026-01-01T00:00:00.000Z", id: 5 });
    expect(parseCursor("2026-01-01T00:00:00.000Z", 730)).toEqual({ at: "2026-01-01T00:00:00.000Z", id: 0 });
    expect(Date.parse(parseCursor(null, 1).at)).toBeGreaterThan(Date.now() - 2 * 864e5);
  });
});

describe("Azure DevOps wiki", () => {
  const wiki = { id: "w1", name: "Rx.Net - Platform Documentations", type: "projectWiki" as const, repositoryId: "r1", remoteUrl: "https://dev.azure.com/org/p/_wiki/wikis/docs" };
  const page = { path: "/Runbooks/Lens Picking", remoteUrl: "https://dev.azure.com/org/p/_wiki/wikis/docs/12/Lens-Picking" };

  it("keeps the readable text of Markdown", () => {
    expect(markdownText("[[_TOC_]]\n# Title\nSee ![shot](a.png) [the guide](https://x) <b>now</b>\n::: mermaid\ngraph TD\n:::\nEnd")).toBe("# Title\nSee  the guide  now\n\nEnd");
  });
  it("maps a page to a document, approved only under the approved paths", () => {
    const item = toWikiPage(wiki, page, "Restart the picking service. Seen in A3415102L and #206985.", m, "\"v1\"");
    expect(item).toMatchObject({ title: "Lens Picking", recordType: "document", evidenceKind: "reference", module: "Runbooks", sourceSystem: "Azure DevOps Wiki", sourceUrl: page.remoteUrl });
    expect(item.links).toEqual([{ ref: "A3415102L", kind: "mentions" }, { ref: "WI-206985", kind: "mentions" }]);
    expect(toWikiPage(wiki, page, "x", { ...m, wiki: { ...m.wiki, approvedPaths: ["/Runbooks"] } }).evidenceKind).toBe("approved");
    expect(toWikiPage(wiki, { path: "/Runbooks-old/x" }, "x", { ...m, wiki: { ...m.wiki, approvedPaths: ["/Runbooks"] } }).evidenceKind).toBe("reference");
  });
  it("reads new pages first, then re-checks the longest-unchecked pages that are due, capped", () => {
    const now = Date.now();
    const pages = [{ path: "/new" }, { path: "/a" }, { path: "/b" }, { path: "/c" }];
    const seen = { "/a": { v: "1", at: now - 30 * 3600_000 }, "/b": { v: "1", at: now - 50 * 3600_000 }, "/c": { v: "1", at: now - 3600_000 } };
    expect(wikiReadPlan(pages, seen, { ...m, wiki: { ...m.wiki, refreshHours: 24, maxRefreshPerSync: 1 } }, now).map((p) => p.path)).toEqual(["/new", "/b"]);
  });
  it("keeps the wiki state from the cursor, and treats older state as due", () => {
    expect(parseWikiState(JSON.stringify({ at: "x", id: 1, wiki: { w1: { "/a": { v: "1", at: 5 } } } }))).toEqual({ w1: { "/a": { v: "1", at: 5 } } });
    expect(parseWikiState(JSON.stringify({ wiki: { w1: { "/a.md": "abc" } } }))).toEqual({ w1: { "/a.md": { v: null, at: 0 } } });
    expect(parseWikiState("2026-01-01T00:00:00Z")).toEqual({});
  });
});

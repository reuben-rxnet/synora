import { describe, expect, it } from "vitest";
import { focusExcerpt, relevanceOf, roleOf, selectEvidence, sourceGroup } from "@/lib/search/evidence";
import { hasEnoughEvidence, isSupported, type Evidence } from "@/lib/search/answer";
import type { Hit } from "@/lib/search/retrieve";

const hit = (recordId: string, over: Partial<Hit> = {}): Hit => ({ recordId, score: 1, similarity: 0.9, keywordRank: null, matchedTerms: 0, termCount: 4, exactRef: false, excerpt: "", ...over });

describe("support rule", () => {
  it("doesn't let a few common words carry an unrelated question", () => {
    // "How many vacation days do I have left": a ticket mentioning "days" and "left" at 0.84
    expect(isSupported(hit("x", { similarity: 0.84, matchedTerms: 2, termCount: 5 }))).toBe(false);
    expect(isSupported(hit("x", { similarity: 0.85, matchedTerms: 0 }))).toBe(false);
  });
  it("accepts strong semantic matches, exact references, and good matches covering the question", () => {
    expect(isSupported(hit("x", { similarity: 0.87 }))).toBe(true);
    expect(isSupported(hit("x", { similarity: 0.5, exactRef: true }))).toBe(true);
    expect(isSupported(hit("x", { similarity: 0.84, matchedTerms: 3, termCount: 4 }))).toBe(true);
  });
  it("needs two supported records, or one exact or approved", () => {
    const ev = (over: Partial<Evidence>) => ({ id: "E1", recordId: "r", ref: "", sourceSystem: "", recordType: "", evidenceKind: "historical", title: "", status: null, application: null, rootCause: null, resolution: null, updatedAt: null, excerpt: "", similarity: 0.9, matchedTerms: 0, exactRef: false, ...over }) as Evidence;
    expect(hasEnoughEvidence([ev({})])).toBe(false);
    expect(hasEnoughEvidence([ev({}), ev({ id: "E2" })])).toBe(true);
    expect(hasEnoughEvidence([ev({ similarity: 0.8, matchedTerms: 1, termCount: 6 }), ev({ id: "E2", similarity: 0.82 })])).toBe(false);
  });
});

describe("evidence selection across sources", () => {
  const groups: Record<string, string> = {};
  const hits = [...Array(10)].map((_, i) => { groups[`h${i}`] = "hda"; return hit(`h${i}`, { score: 1 - i / 100 }); });
  groups.w = "ado-wiki"; groups.d = "demo"; groups.weak = "sharepoint";
  const all = [...hits, hit("w", { score: 0.5 }), hit("weak", { score: 0.4, similarity: 0.7 }), hit("d", { score: 0.3 })];
  it("keeps the strongest eight and gives each other supported source a place, in score order", () => {
    const chosen = selectEvidence(all, (id) => groups[id]!).map((h) => h.recordId);
    expect(chosen.slice(0, 8)).toEqual(["h0", "h1", "h2", "h3", "h4", "h5", "h6", "h7"]);
    expect(chosen.slice(8)).toEqual(["w", "d"]);
  });
  it("never adds a source whose best hit isn't supported", () => {
    expect(selectEvidence(all, (id) => groups[id]!).some((h) => h.recordId === "weak")).toBe(false);
  });
  it("groups demonstration records apart from the source they imitate", () => {
    expect(sourceGroup({ sourceSystem: "SharePoint", demo: true })).toBe("demo");
    expect(sourceGroup({ sourceSystem: "SharePoint" })).toBe("sharepoint");
    expect(sourceGroup({ sourceSystem: "Teams" })).toBe("other");
  });
});

describe("evidence roles and relevance come from metadata only", () => {
  const rec = (over: Record<string, unknown> = {}) => ({ evidenceKind: "historical", status: "Closed", rootCause: null, resolution: null, ...over }) as Parameters<typeof roleOf>[1];
  it("labels what the record establishes, never more", () => {
    expect(roleOf(hit("x"), rec({ resolution: "Restarted the RxCNC service" }))).toBe("temporary-workaround");
    expect(roleOf(hit("x"), rec({ rootCause: "Expired certificate on the gateway", resolution: "Renewed it" }))).toBe("confirmed-resolution");
    expect(roleOf(hit("x"), rec({ rootCause: "Not confirmed", resolution: "Renewed it" }))).toBe("similar-incident");
    expect(roleOf(hit("x"), rec({ evidenceKind: "approved" }))).toBe("authoritative-doc");
    expect(roleOf(hit("x"), rec({ evidenceKind: "reference" }))).toBe("documentation");
    expect(roleOf(hit("x"), rec({ evidenceKind: "dev_work", status: "Active" }))).toBe("investigation");
    expect(roleOf(hit("x"), rec({ evidenceKind: "dev_work", status: "Closed" }))).toBe("development-work");
    expect(roleOf(hit("x", { exactRef: true }), rec())).toBe("direct");
    expect(roleOf(hit("x", { similarity: 0.7 }), rec())).toBe("background");
  });
  it("states retrieval relevance as tiers, not percentages", () => {
    expect(relevanceOf(hit("x", { exactRef: true }))).toBe("exact");
    expect(relevanceOf(hit("x", { similarity: 0.9 }))).toBe("strong");
    expect(relevanceOf(hit("x", { similarity: 0.865 }))).toBe("related");
    expect(relevanceOf(hit("x", { similarity: 0.7 }))).toBe("weak");
  });
});

describe("excerpts", () => {
  it("shows the window that matches the question, without markdown", () => {
    const text = `${"Unrelated setup text. ".repeat(40)}The **RxCNC** service | timed out | after the restart.${" More text.".repeat(30)}`;
    const ex = focusExcerpt(text, ["rxcnc", "timed"]);
    expect(ex).toContain("RxCNC service timed out");
    expect(ex).not.toMatch(/\*\*|\|/);
    expect(ex.startsWith("…")).toBe(true);
  });
});

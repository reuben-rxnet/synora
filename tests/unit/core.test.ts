import { describe, expect, it } from "vitest";
import { canSee, principalsFor, permissionsFor } from "@/lib/access";
import { grantsFromAppRoles } from "@/lib/auth/entra-config";
import { composeWithoutAi, computeConfidence, enforceCitations, hasEnoughEvidence, warningsFor, type Evidence } from "@/lib/search/answer";
import { parseQuery, tsQuery } from "@/lib/search/query";
import { chunkText, effectiveAcl, extractErrorCodes } from "@/lib/ingest";
import { loadMapping, toItem } from "@/lib/connectors/hda/connector";
import { stripHtml } from "@/lib/connectors/hda/client";

const ev = (over: Partial<Evidence>): Evidence => ({
  id: "E1", recordId: "r1", ref: "A1", sourceSystem: "HDA Ticketing", recordType: "incident", evidenceKind: "historical", title: "t", status: "Closed",
  application: null, rootCause: null, resolution: null, updatedAt: new Date("2026-10-01"), excerpt: "x", similarity: 0.9, matchedTerms: 3, exactRef: false, ...over,
});

describe("permissions", () => {
  const me = principalsFor({ userId: "u1", spaceIds: ["it"], groupKeys: ["hda:G1"] });
  it("sees a record shared with one of their spaces or groups", () => {
    expect(canSee(["space:it"], me)).toBe(true);
    expect(canSee(["group:hda:G1"], me)).toBe(true);
    expect(canSee(["everyone"], me)).toBe(true);
  });
  it("does not see other departments or restricted cases", () => {
    expect(canSee(["space:hr"], me)).toBe(false);
    expect(canSee(["group:hda:G-HROPS"], me)).toBe(false);
    expect(canSee([], me)).toBe(false);
  });
  it("restricted items don't get the space added", () => {
    const base = { externalId: "1", ref: "1", recordType: "request" as const, title: "", body: "", evidenceKind: "historical" as const };
    expect(effectiveAcl({ ...base, acl: ["group:hda:G-HROPS"], sensitivity: "restricted" }, "hr")).toEqual(["group:hda:G-HROPS"]);
    expect(effectiveAcl({ ...base, acl: [] }, "it")).toEqual(["space:it"]);
  });
  it("auditors can't manage connectors; administrators can", () => {
    expect(permissionsFor(["auditor"]).has("connectors.manage")).toBe(false);
    expect(permissionsFor(["administrator"]).has("connectors.manage")).toBe(true);
  });
});

describe("Entra app roles", () => {
  it("reads global roles and space grants, ignoring unknown values", () => {
    const g = grantsFromAppRoles(["role.support-engineer", "space.hr.member", "space.hr.owner", "space.it-support.member", "role.superuser", "garbage"]);
    expect([...g.roles]).toEqual(["support-engineer"]);
    expect(g.spaces.get("hr")).toBe("owner");
    expect(g.spaces.get("it-support")).toBe("member");
  });
  it("a space grant alone gives the search-user role", () => {
    expect([...grantsFromAppRoles(["space.finance.member"]).roles]).toEqual(["search-user"]);
  });
});

describe("evidence and citations", () => {
  it("refuses to answer from weak evidence", () => {
    expect(hasEnoughEvidence([ev({ similarity: 0.79, matchedTerms: 1 })])).toBe(false);
    expect(hasEnoughEvidence([ev({ similarity: 0.79, matchedTerms: 1 }), ev({ id: "E2", similarity: 0.8, matchedTerms: 0 })])).toBe(false);
  });
  it("answers from two supported records or one approved article", () => {
    expect(hasEnoughEvidence([ev({}), ev({ id: "E2" })])).toBe(true);
    expect(hasEnoughEvidence([ev({ evidenceKind: "approved" })])).toBe(true);
  });
  const draft = (over: Partial<Parameters<typeof enforceCitations>[0]>) => ({ format: "troubleshooting" as const, heading: "h", summary: [], background: [], explanation: [], steps: [], hypotheses: [], unknowns: [], validation: [], followUps: [], clarification: null, ...over });
  it("drops invented citations and claims left without one", () => {
    const out = enforceCitations(draft({ summary: [{ text: "ok", citations: ["e1", "E9"] }, { text: "made up", citations: ["E7"] }] }), [ev({})]);
    expect(out.summary).toEqual([{ text: "ok", citations: ["E1"] }]);
  });
  it("never shows an uncited step as documented, and keeps hypotheses labelled", () => {
    const out = enforceCitations(draft({
      steps: [{ title: "Restart the service", detail: "", basis: "documented", citations: ["E9"] }, { title: "Check the logs", detail: "", basis: "recommended", citations: [] }],
      explanation: [{ text: "A record states it", status: "documented", citations: ["E9"] }, { text: "Maybe a leak", status: "hypothesis", citations: [] }],
    }), [ev({})]);
    expect(out.steps.map((x) => x.basis)).toEqual(["recommended", "recommended"]);
    expect(out.explanation).toEqual([{ text: "Maybe a leak", status: "hypothesis", citations: [] }]);
  });
  it("keeps functional background only when a document is cited", () => {
    const out = enforceCitations(draft({ background: [{ text: "SML prioritises orders by rule", citations: ["E1"] }, { text: "Invented background", citations: [] }] }), [ev({})]);
    expect(out.background).toEqual([{ text: "SML prioritises orders by rule", citations: ["E1"] }]);
  });
  it("removes evidence ids left in plain-text lists", () => {
    expect(enforceCitations(draft({ unknowns: ["The cause [E1] is unconfirmed ."], followUps: ["What fixed E2?"] }), [ev({})])).toMatchObject({ unknowns: ["The cause is unconfirmed."], followUps: ["What fixed?"] });
  });
});

describe("confidence and warnings", () => {
  it("is medium when several records agree but no root cause is confirmed", () => {
    const c = computeConfidence([ev({ rootCause: "Not confirmed" }), ev({ id: "E2", evidenceKind: "dev_work" }), ev({ id: "E3", evidenceKind: "approved" }), ev({ id: "E4", resolution: "Service restart provided temporary recovery." })], new Date("2026-10-27"));
    expect(c.level).toBe("medium");
    expect(c.why).toMatch(/does not confirm a permanent root cause/);
  });
  it("is high with approved knowledge and a confirmed cause", () => {
    expect(computeConfidence([ev({ evidenceKind: "approved", status: "Published" }), ev({ id: "E2", rootCause: "Firewall rule reset during patching.", status: "Resolved", resolution: "Re-applied rule" })], new Date("2026-10-27")).level).toBe("high");
  });
  it("warns that a restart is temporary", () => {
    expect(warningsFor([ev({ resolution: "Service restart provided temporary recovery." })]).map((w) => w.kind)).toContain("temporary-fix");
  });
  it("the no-AI answer never recommends the temporary fix", () => {
    const { body } = composeWithoutAi("q", [ev({ resolution: "Service restart provided temporary recovery.", rootCause: "Not confirmed. Possibly sockets." }), ev({ id: "E2", evidenceKind: "approved", resolution: "Check sockets and the pool." })], false);
    expect(body.steps.map((s) => s.title).join(" ")).not.toMatch(/restart/i);
    expect(body.summary[0]!.citations).toEqual(["E2"]);
  });
});

describe("query parsing", () => {
  it("finds references, error codes and applications", () => {
    const q = parseQuery("A5058563L and BUG-1842 show ERR_CONN_TIMEOUT on rx cnc", [{ alias: "rx cnc", application: "RxCNC" }]);
    expect(q.refs).toEqual(["A5058563L", "BUG-1842"]);
    expect(q.errorCodes).toContain("ERR_CONN_TIMEOUT");
    expect(q.applications).toEqual(["RxCNC"]);
  });
  it("builds a safe OR query", () => {
    expect(tsQuery(["timeout", "it's", "a;drop"])).toBe("timeout:* | it:* | drop:*");
    expect(tsQuery([])).toBeNull();
  });
});

describe("ingest", () => {
  it("keeps short records in one chunk and splits long ones with the title repeated", () => {
    expect(chunkText("T", "short")).toEqual(["T\nshort"]);
    const parts = chunkText("Title", "Sentence one. ".repeat(300));
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.startsWith("Title"))).toBe(true);
  });
  it("extracts error codes", () => {
    expect(extractErrorCodes("Gateway gave HTTP 504 then AADSTS50011")).toEqual(["HTTP 504", "AADSTS50011"]);
  });
});

describe("HDA mapping", () => {
  const m = loadMapping("config/hda-mapping.json");
  const row = { id: "A5070112L", subject: "Printer down", description: "<p>Store printer &amp; scanner down</p>", solution: "&lt;p&gt;Replaced cable&lt;/p&gt;", objectType: "T10C", status: "S5", ownerGroupId: "G815L", ownerGroupName: "EUS", solvedAt: "2026-10-20T10:00:00Z" };
  it("maps an IT incident to the IT Support space, visible to the space", () => {
    const item = toItem(row, m, "https://hda.example/HDAPortal")!;
    expect(item.spaceKey).toBe("it-support");
    expect(item.acl).toEqual([]);
    expect(item.status).toBe("Closed");
    expect(item.resolution).toBe("Replaced cable");
    expect(item.body).toContain("Store printer & scanner down");
  });
  it("keeps HR requests to the owner group only", () => {
    const item = toItem({ ...row, objectType: "T12L" }, m, "https://hda.example")!;
    expect(item.spaceKey).toBe("hr");
    expect(item.sensitivity).toBe("restricted");
    expect(item.acl).toEqual(["group:hda:G815L"]);
  });
  it("never indexes security incidents or report leaks", () => {
    expect(toItem({ ...row, objectType: "T21L" }, m, "x")).toBeNull();
    expect(toItem({ ...row, objectType: "T30L" }, m, "x")).toBeNull();
  });
  it("strips HDA's double-encoded HTML", () => {
    expect(stripHtml("&lt;p&gt;qualit&amp;#224;&lt;/p&gt;")).toBe("qualità");
  });
});

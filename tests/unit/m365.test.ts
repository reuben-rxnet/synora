import { deflateRawSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { drawioText, extractText, fileKind, fileKindLabel, pngDrawio, svgText } from "@/lib/connectors/m365/extract";
import { listFiles, loadM365Mapping, parseFileState, skipReason, toFileItem, type ChosenFolder } from "@/lib/connectors/m365/connector";
import { seal, unseal } from "@/lib/connectors/m365/auth";
import type { DriveItem } from "@/lib/connectors/m365/graph";

const m = loadM365Mapping("config/m365-mapping.json");
const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="2" value="Lens &lt;b&gt;picking&lt;/b&gt; service" vertex="1"/><mxCell id="3" value="Print queue" vertex="1"/><mxCell id="4" value="" edge="1"/></root></mxGraphModel>`;
// draw.io's compressed page format: URI-encode, raw-deflate, base64.
const compressed = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");

/** A PNG with one text chunk, as draw.io writes "PNG with diagram". */
function png(chunkType: "tEXt" | "zTXt", keyword: string, text: string) {
  const crcless = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]); };
  const data = chunkType === "tEXt" ? Buffer.concat([Buffer.from(`${keyword}\0`, "latin1"), Buffer.from(text, "latin1")]) : Buffer.concat([Buffer.from(`${keyword}\0\0`, "latin1"), deflateSync(Buffer.from(text, "latin1"))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crcless("IHDR", Buffer.alloc(13)), crcless(chunkType, data), crcless("IEND", Buffer.alloc(0))]);
}

/** The smallest PDF with one line of text. */
function pdf(text: string) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 12 Tf 10 50 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 12 Tf 10 50 Td (${text}) Tj ET\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

describe("file formats", () => {
  it("knows which formats it reads", () => {
    for (const n of ["a.doc", "a.docx", "a.xls", "a.xlsx", "a.ppt", "a.pptx", "a.pdf", "a.md", "a.txt", "a.html", "a.png", "a.jpg", "a.drawio", "flow.drawio.xml", "a.svg"]) expect(fileKind(n), n).not.toBeNull();
    expect(fileKind("a.exe")).toBeNull();
    expect(fileKind("flow.drawio.png")).toBe("image");
    expect(fileKindLabel("Budget.XLSX")).toBe("Excel workbook");
    expect(fileKindLabel("deck.ppt")).toBe("PowerPoint presentation");
  });
  it("reads draw.io labels from plain and compressed pages", () => {
    expect(drawioText(`<mxfile><diagram name="Overview">${model.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</diagram></mxfile>`)).toBe("Page: Overview\nLens picking service\nPrint queue");
    expect(drawioText(`<mxfile><diagram name="Flow">${compressed}</diagram></mxfile>`)).toBe("Page: Flow\nLens picking service\nPrint queue");
    expect(drawioText(model)).toBe("Lens picking service\nPrint queue");
  });
  it("reads SVG text, and the diagram inside a .drawio.svg", () => {
    expect(svgText(`<svg><title>Network</title><text x="1">Router A</text><text><tspan>Switch</tspan></text></svg>`)).toBe("Network\nRouter A\nSwitch");
    const content = `<mxfile><diagram name="P1">${compressed}</diagram></mxfile>`.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    expect(svgText(`<svg content="${content}"><text>ignored</text></svg>`)).toBe("Page: P1\nLens picking service\nPrint queue");
  });
  it("finds a draw.io diagram stored in a PNG", () => {
    const xml = `<mxfile><diagram name="Png">${compressed}</diagram></mxfile>`;
    expect(pngDrawio(png("tEXt", "mxfile", encodeURIComponent(xml)))).toBe("Page: Png\nLens picking service\nPrint queue");
    expect(pngDrawio(png("zTXt", "mxfile", encodeURIComponent(xml)))).toBe("Page: Png\nLens picking service\nPrint queue");
    expect(pngDrawio(png("tEXt", "Software", "paint"))).toBeNull();
  });
  it("reads text, HTML and PDF files", async () => {
    expect(await extractText("notes.md", Buffer.from("﻿# Restart\nRun the job"))).toEqual({ text: "# Restart\nRun the job", method: "text" });
    expect((await extractText("page.html", Buffer.from("<html><style>p{}</style><p>Clear the <b>queue</b></p><script>x()</script></html>")))!.text).toBe("Clear the queue");
    expect((await extractText("sop.pdf", pdf("Clear the print queue")))!.text).toContain("Clear the print queue");
    expect(await extractText("tool.exe", Buffer.from("x"))).toBeNull();
  });
});

describe("SharePoint & OneDrive files", () => {
  const folder: ChosenFolder = { driveId: "d1", itemId: "f1", name: "Procedures", path: "Central Rx Operations Support/Documents/Procedures", source: "sharepoint" };
  const file: DriveItem = { id: "i1", name: "Print queue.docx", size: 20_480, webUrl: "https://x.sharepoint.com/i1", cTag: "c1", lastModifiedDateTime: "2026-10-01T10:00:00Z", file: {}, lastModifiedBy: { user: { displayName: "Jane Example" } } };

  it("maps a file to a reference document; people stay out of the text", () => {
    const item = toFileItem(folder, file, `${folder.path}/Printing`, { text: "Restart spooler. See A3415102L and WI-206985.", method: "converted to PDF by Microsoft 365" }, m);
    expect(item).toMatchObject({ externalId: "d1:i1", ref: "Print queue.docx", sourceSystem: "SharePoint", recordType: "document", evidenceKind: "reference", category: "Word document", sourceUrl: file.webUrl });
    expect(item.body.startsWith(`${folder.path}/Printing/Print queue.docx`)).toBe(true);
    expect(item.body).not.toContain("Jane Example");
    expect(item.links).toEqual([{ ref: "A3415102L", kind: "mentions" }, { ref: "WI-206985", kind: "mentions" }]);
    expect((item.raw as { folderKey: string }).folderKey).toBe("d1:f1");
    expect(toFileItem({ ...folder, approved: true, source: "onedrive" }, file, "OneDrive", { text: "x", method: "text" }, m)).toMatchObject({ evidenceKind: "approved", sourceSystem: "OneDrive" });
  });
  it("lists readable files below a folder, skipping unknown formats and OneNote packages", async () => {
    const tree: Record<string, DriveItem[]> = {
      f1: [{ id: "sub", name: "Printing", folder: {} }, { id: "a", name: "SOP.pdf", file: {} }, { id: "b", name: "tool.exe", file: {} }, { id: "nb", name: "Notebook", folder: {}, package: { type: "oneNote" } }],
      sub: [{ id: "c", name: "flow.drawio", file: {} }],
    };
    const files = await listFiles({ children: async (_d: string, id: string) => tree[id] ?? [] } as never, folder, m);
    expect(files.map((f) => `${f.path}|${f.item.name}`)).toEqual([`${folder.path}|SOP.pdf`, `${folder.path}/Printing|flow.drawio`]);
  });
  it("skips files above the size limits", () => {
    expect(skipReason({ ...file, size: 60 * 1_048_576 }, m)).toBe("larger than 50 MB");
    expect(skipReason({ ...file, name: "scan.png", size: 20 * 1_048_576 }, m)).toBe("larger than 15 MB");
    expect(skipReason(file, m)).toBeNull();
  });
  it("keeps the per-folder change tags in the cursor", () => {
    expect(parseFileState(JSON.stringify({ files: { "d1:f1": { i1: "c1" } } }))).toEqual({ "d1:f1": { i1: "c1" } });
    expect(parseFileState(null)).toEqual({});
  });
  it("stores the Microsoft 365 sign-in encrypted", () => {
    const sealed = seal("refresh-token-value");
    expect(sealed).not.toContain("refresh-token-value");
    expect(unseal(sealed)).toBe("refresh-token-value");
    expect(() => unseal(sealed.replace(/.$/, (ch) => (ch === "A" ? "B" : "A")))).toThrow();
  });
});

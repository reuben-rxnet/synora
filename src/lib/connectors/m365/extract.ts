// Readable text from the files people keep in SharePoint and OneDrive.
//   * Word, Excel and PowerPoint (old binary and new formats): Microsoft Graph converts them to PDF on its side,
//     and the PDF's text is read here, so one reader covers every Office format.
//   * PDF: read directly. Markdown, text, CSV and HTML: decoded as text.
//   * draw.io (.drawio, .drawio.xml, and diagrams embedded in .drawio.svg / .drawio.png): page names and labels.
//   * Images: text recognition (OCR) on this server, so pictures never leave Synora. SVG: its text elements.
import { inflateRawSync, inflateSync } from "node:zlib";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { stripHtml } from "../hda/client";

export type FileKind = "office" | "pdf" | "text" | "html" | "drawio" | "svg" | "image";
const KINDS: Record<string, FileKind> = {
  doc: "office", docx: "office", docm: "office", dot: "office", dotx: "office", rtf: "office", odt: "office",
  xls: "office", xlsx: "office", xlsm: "office", xlsb: "office", ods: "office",
  ppt: "office", pptx: "office", pptm: "office", pps: "office", ppsx: "office", odp: "office",
  pdf: "pdf", txt: "text", md: "text", markdown: "text", csv: "text", log: "text", json: "text", xml: "text",
  html: "html", htm: "html", drawio: "drawio", dio: "drawio", svg: "svg",
  png: "image", jpg: "image", jpeg: "image", gif: "image", bmp: "image", tif: "image", tiff: "image", webp: "image",
};
const LABELS: Record<FileKind, string> = { office: "Office document", pdf: "PDF", text: "Text file", html: "Web page", drawio: "draw.io diagram", svg: "SVG image", image: "Image" };

/** What a file name is, or null when Synora doesn't read that format. "x.drawio.xml" counts as draw.io. */
export function fileKind(name: string): FileKind | null {
  const lower = name.toLowerCase();
  if (/\.(drawio|dio)\.(xml|svg|png)$/.test(lower)) return lower.endsWith(".png") ? "image" : lower.endsWith(".svg") ? "svg" : "drawio";
  return KINDS[lower.split(".").pop() ?? ""] ?? null;
}
export const fileKindLabel = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const k = fileKind(name);
  if (k === "office") return /^xl|^ods/.test(ext) ? "Excel workbook" : /^pp|^odp/.test(ext) ? "PowerPoint presentation" : "Word document";
  return k ? LABELS[k] : "File";
};

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** A draw.io page's model: plain XML, or deflated + base64 (+ URI-encoded) as draw.io saves compressed pages. */
function diagramXml(inner: string): string {
  const t = decodeXml(inner.trim());
  if (t.startsWith("<")) return t;
  try {
    const raw = inflateRawSync(Buffer.from(t, "base64")).toString("utf8");
    try { return decodeURIComponent(raw); } catch { return raw; }
  } catch { return ""; }
}

/** Page names and every shape and connector label of a draw.io file. Exported for tests. */
export function drawioText(xml: string): string {
  const pages = [...xml.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)];
  const models = pages.length ? pages.map((p) => ({ name: /\bname="([^"]*)"/.exec(p[1]!)?.[1] ?? "", xml: diagramXml(p[2]!) })) : [{ name: "", xml }];
  const out: string[] = [];
  for (const m of models) {
    const labels = [...m.xml.matchAll(/<(?:mxCell|UserObject|object)\b[^>]*?\b(?:value|label)="([^"]*)"/g)]
      .map((x) => stripHtml(decodeXml(x[1]!)).replace(/\s+/g, " ").trim()).filter(Boolean);
    if (m.name || labels.length) out.push([m.name ? `Page: ${decodeXml(m.name)}` : "", ...new Set(labels)].filter(Boolean).join("\n"));
  }
  return out.join("\n\n");
}

/** Text of an SVG (its <text>, <title> and <desc>), or the draw.io diagram it carries. Exported for tests. */
export function svgText(svg: string): string {
  const embedded = /\bcontent="([^"]*mxfile[^"]*)"/.exec(svg)?.[1];
  if (embedded) return drawioText(decodeXml(embedded));
  return [...svg.matchAll(/<(text|tspan|title|desc)\b[^>]*>([^<]*)(?=<)/g)].map((m) => decodeXml(m[2]!).trim()).filter(Boolean).join("\n");
}

/** The draw.io diagram stored in a PNG's text chunk by "Export as PNG with diagram", if any. */
export function pngDrawio(buf: Buffer): string | null {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  for (let i = 8; i + 8 <= buf.length;) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      const nul = data.indexOf(0);
      if (nul > 0 && data.toString("latin1", 0, nul) === "mxfile") {
        let text: string;
        if (type === "tEXt") text = data.toString("latin1", nul + 1);
        else if (type === "zTXt") text = inflateSync(data.subarray(nul + 2)).toString("latin1"); // keyword\0 method data
        else {
          // iTXt: keyword\0 flag method language\0 translated-keyword\0 text
          const lang = data.indexOf(0, nul + 3);
          const body = data.subarray(data.indexOf(0, lang + 1) + 1);
          text = (data[nul + 1] ? inflateSync(body) : body).toString("utf8");
        }
        try { text = decodeURIComponent(text); } catch { /* already plain */ }
        return drawioText(text);
      }
    }
    if (type === "IEND") break;
    i += 12 + len;
  }
  return null;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text);
}

type OcrWorker = { recognize: (img: Buffer) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };
let ocr: Promise<OcrWorker> | null = null;
/** One OCR worker per process; the language data is downloaded once into .models/tesseract. */
async function ocrText(bytes: Buffer): Promise<string> {
  ocr ??= import("tesseract.js").then(({ createWorker }) => {
    const cachePath = join(process.cwd(), ".models", "tesseract");
    mkdirSync(cachePath, { recursive: true }); // tesseract.js silently skips its cache when the folder is missing
    return createWorker((process.env.OCR_LANGUAGES || "eng").split(/[+,\s]+/).filter(Boolean), 1, { cachePath }) as Promise<OcrWorker>;
  });
  const { data } = await (await ocr).recognize(bytes);
  return data.text;
}
export async function closeOcr() { if (ocr) { const w = ocr; ocr = null; await (await w).terminate().catch(() => undefined); } }

export interface Extracted { text: string; method: string }
/**
 * Reads one file. `bytes` is the original file, except for Office files, where it is the PDF Microsoft Graph
 * converted it to. Unknown formats give null.
 */
export async function extractText(name: string, bytes: Buffer): Promise<Extracted | null> {
  const kind = fileKind(name);
  const utf8 = () => bytes.toString("utf8").replace(/^﻿/, "");
  switch (kind) {
    case "office": return { text: await pdfText(bytes), method: "converted to PDF by Microsoft 365" };
    case "pdf": return { text: await pdfText(bytes), method: "PDF text" };
    case "text": return { text: utf8(), method: "text" };
    case "html": return { text: stripHtml(utf8().replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")), method: "web page text" };
    case "drawio": return { text: drawioText(utf8()), method: "draw.io labels" };
    case "svg": return { text: svgText(utf8()), method: /mxfile/.test(utf8()) ? "draw.io labels" : "SVG text" };
    case "image": {
      const diagram = pngDrawio(bytes);
      if (diagram !== null) return { text: diagram, method: "draw.io labels" };
      return { text: await ocrText(bytes), method: "text recognition (OCR)" };
    }
    default: return null;
  }
}

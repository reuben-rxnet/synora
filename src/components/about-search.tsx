"use client";
// Search within the About page: filters the features, guides, steps, troubleshooting, glossary and tech stack to
// what matches, opens matching guides, highlights the words, and hides sections (and their menu links) without
// a match. Every word must match, ignoring case and accents. The page itself stays server-rendered.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const HIGHLIGHT = "about-search";

export function AboutSearch() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ items: number; sections: number } | null>(null);
  const opened = useRef(new Set<HTMLDetailsElement>());

  useEffect(() => {
    const body = document.querySelector<HTMLElement>("[data-about-body]");
    if (!body) return;
    const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
    const sections = [...body.querySelectorAll<HTMLElement>("[data-about-section]")];
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    highlights?.delete(HIGHLIGHT);

    // Cleared: show everything again and close the guides the search opened.
    if (!words.length) {
      body.querySelectorAll<HTMLElement>("[data-about-item], [data-about-section]").forEach((el) => { el.style.display = ""; });
      document.querySelectorAll<HTMLElement>("[data-about-link]").forEach((el) => { el.style.display = ""; });
      opened.current.forEach((d) => { d.open = false; });
      opened.current.clear();
      const t = setTimeout(() => setResult(null), 0);
      return () => clearTimeout(t);
    }

    const matches = (el: HTMLElement) => { const text = norm(el.textContent ?? ""); return words.every((w) => text.includes(w)); };
    const shown: HTMLElement[] = [];
    let items = 0, visibleSections = 0;
    for (const section of sections) {
      const heading = section.querySelector("h2");
      const headingHit = heading ? matches(heading) : false;
      const units = [...section.querySelectorAll<HTMLElement>("[data-about-item]")];
      let hits = 0;
      for (const u of units) {
        const hit = headingHit || matches(u);
        u.style.display = hit ? "" : "none";
        if (hit) { hits++; shown.push(u); }
        if (u instanceof HTMLDetailsElement && hit && !u.open && !headingHit) { u.open = true; opened.current.add(u); }
      }
      const visible = headingHit || hits > 0;
      section.style.display = visible ? "" : "none";
      const link = document.querySelector<HTMLElement>(`[data-about-link="${section.id}"]`);
      if (link) link.style.display = visible ? "" : "none";
      if (visible) { visibleSections++; items += headingHit ? units.length : hits; }
    }

    // Highlight the words in what is shown (CSS Custom Highlight API; skipped where unsupported).
    const Highlight = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (highlights && Highlight) {
      const ranges: Range[] = [];
      for (const root of shown) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = norm(n.textContent ?? "");
          for (const w of words) {
            for (let i = text.indexOf(w); i !== -1; i = text.indexOf(w, i + w.length)) {
              const r = new Range(); r.setStart(n, i); r.setEnd(n, i + w.length); ranges.push(r);
            }
          }
        }
      }
      highlights.set(HIGHLIGHT, new Highlight(...ranges));
    }
    const t = setTimeout(() => setResult({ items, sections: visibleSections }), 0);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="about-search" role="search">
      <label className="eyebrow" htmlFor="about-q">Search this page</label>
      <div className="about-search-box">
        <Icon name="search" size={16} />
        <input id="about-q" className="input" type="search" placeholder="e.g. owner groups, VPN, OCR" value={q} autoComplete="off"
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
      </div>
      {result && (
        <p className="small muted" aria-live="polite">
          {result.items ? `${result.items} match${result.items === 1 ? "" : "es"} in ${result.sections} section${result.sections === 1 ? "" : "s"}` : <>Nothing on this page matches. <Link href={`/?q=${encodeURIComponent(q)}`}>Ask Synora</Link> instead.</>}
        </p>
      )}
    </div>
  );
}

"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { getBookAnnotations, HIGHLIGHT_COLORS, type Annotation } from "./annotations";
import { loadOcr } from "./ocr";

// Sohbetin kullanıcının işaretlerini görmesi için: fosforlu kalemle çizilen yerlerin ve metin
// vurgularının altında kalan yazı, geçtiği satırdan başlayan bir parçayla birlikte bulunur.
// Kalem çizgisi yalnızca koordinattır; altındaki yazı sayfanın metin konumlarından çıkarılır.

/** Sayfadaki bir metin parçası: düz metindeki yeri ve sayfadaki kutusu (0–1). */
type Piece = { start: number; text: string; x0: number; y0: number; x1: number; y1: number };
type PageLayout = { text: string; pieces: Piece[] };

// İşaretin ardından modele gönderilen metin (soru kökü ve şıklar sığsın diye)
const CONTEXT_CHARS = 600;
const TOTAL_CHARS = 12000;
// Kalem çizgisi bu aralıklarla örneklenir (sayfa genişliğine oranla)
const STEP = 0.004;

const COLOR_NAMES: Record<string, string> = Object.fromEntries(
  HIGHLIGHT_COLORS.map((c) => [c.color.toLowerCase(), c.label.toLocaleLowerCase("tr")]),
);
const colorName = (c: string) => COLOR_NAMES[c.toLowerCase()] ?? c;

/** pdf.js metni; getPageText ile aynı birleştirme (konumlar düz metindeki yere denk gelsin). */
async function textLayout(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageLayout> {
  const page = await pdf.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  let text = "";
  const pieces: Piece[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const t = item.transform as number[];
    const size = Math.hypot(t[2], t[3]) || item.height;
    const [ax, ay] = vp.convertToViewportPoint(t[4], t[5]);
    const [bx, by] = vp.convertToViewportPoint(t[4] + item.width, t[5] + size);
    if (item.str.trim()) {
      pieces.push({
        start: text.length,
        text: item.str,
        x0: Math.min(ax, bx) / vp.width,
        x1: Math.max(ax, bx) / vp.width,
        y0: Math.min(ay, by) / vp.height,
        y1: Math.max(ay, by) / vp.height,
      });
    }
    text += item.str + (item.hasEOL ? " " : "");
  }
  return { text, pieces };
}

/** Taranmış sayfa: OCR kelimeleri (loadOcrText ile aynı birleştirme). */
async function ocrLayout(book: string, pageNumber: number): Promise<PageLayout | null> {
  const ocr = await loadOcr(book, pageNumber);
  if (!ocr) return null;
  let text = "";
  const pieces: Piece[] = [];
  for (const line of ocr.lines) {
    for (const w of line) {
      if (text) text += " ";
      pieces.push({ start: text.length, text: w.t, x0: w.b[0], y0: w.b[1], x1: w.b[2], y1: w.b[3] });
      text += w.t;
    }
  }
  return { text, pieces };
}

async function pageLayout(pdf: PDFDocumentProxy, book: string, pageNumber: number) {
  const layout = await textLayout(pdf, pageNumber);
  if (layout.text.replace(/\s/g, "").length >= 20) return layout;
  return (await ocrLayout(book, pageNumber)) ?? layout;
}

/** Çizginin üzerindeki noktalar (aralar doldurulur; Shift ile çizilen düz çizgi 2 noktadır). */
function samples(points: number[], aspect: number) {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    out.push([x, y]);
    if (i + 3 >= points.length) break;
    const nx = points[i + 2];
    const ny = points[i + 3];
    const n = Math.ceil(Math.hypot(nx - x, (ny - y) / aspect) / STEP);
    for (let k = 1; k < n; k++) out.push([x + ((nx - x) * k) / n, y + ((ny - y) * k) / n]);
  }
  return out;
}

/** İşaretin değdiği metin parçaları ve her parçada değen yatay aralık. */
function touched(layout: PageLayout, pts: [number, number][], rx: number, ry: number) {
  const hits = new Map<Piece, [number, number]>();
  for (const [x, y] of pts) {
    for (const p of layout.pieces) {
      if (x < p.x0 - rx || x > p.x1 + rx || y < p.y0 - ry || y > p.y1 + ry) continue;
      const span = hits.get(p);
      hits.set(p, span ? [Math.min(span[0], x - rx), Math.max(span[1], x + rx)] : [x - rx, x + rx]);
    }
  }
  return hits;
}

/** Parçada kalemin kapladığı kısım; harfler eşit genişlikte sayılır, kelime sınırına genişletilir. */
function coveredText(p: Piece, [from, to]: [number, number]) {
  const w = p.x1 - p.x0 || 1;
  const n = p.text.length;
  let a = Math.max(0, Math.floor(((from - p.x0) / w) * n));
  let b = Math.min(n, Math.ceil(((to - p.x0) / w) * n));
  while (a > 0 && /\S/.test(p.text[a - 1])) a--;
  while (b < n && /\S/.test(p.text[b])) b++;
  return p.text.slice(a, b).trim();
}

type Mark = { page: number; kind: string; marked: string; context: string; at?: number };

/** Numaralı soruyla başlıyorsa ("3.", "3)", "Soru 3") bir sonraki sorunun başında keser. */
function untilNextQuestion(context: string) {
  const m = context.match(/^(soru\s*)?(\d{1,3})\s*[.)\-]/i);
  if (!m) return context;
  const next = new RegExp(`\\s(soru\\s*)?${+m[2] + 1}\\s*[.)-]\\s`, "i").exec(context);
  return next ? context.slice(0, next.index) : context;
}

function findMark(layout: PageLayout, a: Annotation, page: number, aspect: number): Mark | null {
  if (a.type === "text") {
    return a.text.trim() ? { page, kind: "kullanıcının sayfaya yazdığı not", marked: a.text.trim(), context: "" } : null;
  }
  let pts: [number, number][];
  let rx: number;
  if (a.type === "highlight") {
    pts = [];
    for (let i = 0; i < a.rects.length; i += 4) {
      const [x, y, w, h] = a.rects.slice(i, i + 4);
      pts.push(...samples([x, y + h / 2, x + w, y + h / 2], aspect));
    }
    rx = 0.002;
  } else if (a.marker) {
    pts = samples(a.points, aspect);
    rx = a.width / 2;
  } else {
    return null; // Kalemle yazılanlar el yazısı/çizim; altındaki metinle ilgisi belirsiz
  }
  const hits = touched(layout, pts, rx, rx * aspect);
  const kind = `${colorName(a.color)} ${a.type === "highlight" ? "vurgu" : "fosforlu kalem"}`;
  if (!hits.size) {
    return a.type === "highlight" && a.text.trim() ? { page, kind, marked: a.text.trim(), context: "" } : null;
  }
  const pieces = [...hits.keys()].sort((p, q) => p.start - q.start);
  const marked =
    a.type === "highlight" && a.text.trim()
      ? a.text.trim()
      : pieces.map((p) => coveredText(p, hits.get(p)!)).filter(Boolean).join(" ");
  // İşaretin bulunduğu satırın başından itibaren (soru numarası işaretliyse soru kökü ve şıklar)
  const first = pieces[0];
  const lineStart = Math.min(
    ...layout.pieces
      .filter((p) => p.start <= first.start && Math.abs(p.y1 - first.y1) < (first.y1 - first.y0) / 2)
      .map((p) => p.start),
    first.start,
  );
  const context = untilNextQuestion(layout.text.slice(lineStart, lineStart + CONTEXT_CHARS).replace(/\s+/g, " ").trim());
  return { page, kind, marked, context, at: lineStart };
}

/**
 * Kitaptaki işaretler (vurgu, fosforlu kalem, sayfa notları) sohbet için metin olarak.
 * Çok işaret varsa açık sayfaya yakın olanlar öncelikli. İşaret yoksa null.
 */
export async function getMarksText(pdf: PDFDocumentProxy, book: string, currentPage: number) {
  const all = getBookAnnotations(book);
  const pages = Object.keys(all)
    .map(Number)
    .filter((p) => p >= 1 && p <= pdf.numPages && all[p].some((a) => a.type !== "ink" || a.marker))
    .sort((a, b) => Math.abs(a - currentPage) - Math.abs(b - currentPage) || a - b);
  if (!pages.length) return null;

  const marks: Mark[] = [];
  let size = 0;
  let skipped = 0;
  for (const page of pages) {
    if (size > TOTAL_CHARS) {
      skipped += all[page].length;
      continue;
    }
    let layout: PageLayout;
    let aspect = 1;
    try {
      const p = await pdf.getPage(page);
      const vp = p.getViewport({ scale: 1 });
      aspect = vp.width / vp.height;
      layout = await pageLayout(pdf, book, page);
    } catch {
      continue;
    }
    const seen = new Set<string>();
    for (const a of all[page]) {
      const m = findMark(layout, a, page, aspect);
      if (!m) {
        if (a.type === "ink" && a.marker && !layout.pieces.length) {
          // Taranmış ve OCR yapılmamış sayfa: işaret var ama altındaki yazı bilinmiyor
          const key = "unread";
          if (!seen.has(key)) {
            seen.add(key);
            marks.push({ page, kind: `${colorName(a.color)} fosforlu kalem`, marked: "(yazı okunamadı: sayfa taranmış, metin tanıma yapılmamış)", context: "" });
          }
        }
        continue;
      }
      // Aynı satıra çizilen birden çok çizgi tek işaret
      const key = m.kind + "|" + (m.context.slice(0, 80) || m.marked);
      if (seen.has(key)) continue;
      seen.add(key);
      marks.push(m);
      size += m.marked.length + m.context.length + 40;
    }
  }
  if (!marks.length) return null;

  marks.sort((a, b) => a.page - b.page || (a.at ?? 0) - (b.at ?? 0));
  const lines = marks.map(
    (m) =>
      `- s. ${m.page} · ${m.kind}: «${m.marked.slice(0, 300)}»${m.context ? `\n  Geçtiği yer: «${m.context}»` : ""}`,
  );
  if (skipped) lines.push(`(Açık sayfadan uzak sayfalarda yaklaşık ${skipped} işaret daha var; sığmadığı için gösterilmedi.)`);
  return lines.join("\n");
}

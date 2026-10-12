export type PdfSelection = {
  word: string;
  sentence: string;
  page: number | null;
};

const MAX_SENTENCE_LENGTH = 600;

/**
 * PDF metin katmanındaki seçimden seçilen kelimeyi ve içinde geçtiği cümleyi çıkarır.
 * pdf.js metin katmanı satırları ayrı <span>'lere, satır sonlarını <br>'lere böler;
 * bu yüzden katmandaki tüm metni yeniden kurup seçimin konumunu buluyoruz.
 */
export function extractSelection(selection: Selection): PdfSelection | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  const startEl =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const layer = startEl?.closest(".textLayer, .ocr-layer");
  if (!layer) return null;

  const pageEl = layer.closest<HTMLElement>("[data-page-number]");
  const page = pageEl ? Number(pageEl.dataset.pageNumber) : null;

  // Katmandaki metni kur, her metin düğümünün metindeki başlangıcını tut
  let text = "";
  const segments: { node: Text; start: number }[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).tagName === "BR") text += " ";
      continue;
    }
    segments.push({ node: node as Text, start: text.length });
    text += (node as Text).data;
  }

  const start = boundaryOffset(segments, range.startContainer, range.startOffset, "start");
  const end = boundaryOffset(segments, range.endContainer, range.endOffset, "end");

  if (start < 0 || end < 0) {
    const word = cleanWord(selection.toString());
    return word && word.split(" ").length <= 8 ? { word, sentence: "", page } : null;
  }

  // Yarım seçilen kelimeyi tamamla: "embellishmen" → "embellishment"
  const expanded = expandToWords(text, start, end);
  if (!expanded) return null;
  const word = cleanWord(joinHyphenation(text.slice(expanded.start, expanded.end)));
  if (!word || word.split(" ").length > 8) return null;

  // Ekrandaki seçimi de tam kelimeye genişlet
  if (expanded.start !== start || expanded.end !== end) {
    const from = pointAt(segments, expanded.start, "start");
    const to = pointAt(segments, expanded.end, "end");
    if (from && to) {
      const full = document.createRange();
      full.setStart(from.node, from.offset);
      full.setEnd(to.node, to.offset);
      selection.removeAllRanges();
      selection.addRange(full);
    }
  }

  return { word, sentence: sentenceAround(text, expanded.start, expanded.end), page };
}

const MAX_REFERENCE_LENGTH = 6000;

/** Sohbet referansı için: PDF'te seçili metin (uzunluk sınırı yok, paragraf da olabilir). */
export function selectedPdfText(selection: Selection): { text: string; page: number | null } | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const node = selection.getRangeAt(0).startContainer;
  const el = node instanceof Element ? node : node.parentElement;
  const layer = el?.closest(".textLayer, .ocr-layer");
  if (!layer) return null;

  const pageEl = layer.closest<HTMLElement>("[data-page-number]");
  const text = joinHyphenation(selection.toString())
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\d{1,3}\s+(?=\p{Lu})/u, "") // baştaki dipnot numarası
    .replace(FOOTNOTE_MARK, "$1");
  if (!text) return null;
  return {
    text: text.slice(0, MAX_REFERENCE_LENGTH),
    page: pageEl ? Number(pageEl.dataset.pageNumber) : null,
  };
}

type Segment = { node: Text; start: number };

/** Seçim sınırını (düğüm + ofset) katman metnindeki konuma çevirir. */
function boundaryOffset(segments: Segment[], container: Node, offset: number, side: "start" | "end") {
  if (container.nodeType === Node.TEXT_NODE) {
    const seg = segments.find((s) => s.node === container);
    return seg ? seg.start + offset : -1;
  }
  // Sınır bir elemanın çocukları arasındaysa en yakın metin düğümüne bağla
  const child = side === "start" ? container.childNodes[offset] : container.childNodes[offset - 1];
  if (!child) return -1;
  const inside = segments.filter((s) => child === s.node || child.contains(s.node));
  if (inside.length) {
    return side === "start" ? inside[0].start : inside.at(-1)!.start + inside.at(-1)!.node.length;
  }
  const after = segments.find(
    (s) => child.compareDocumentPosition(s.node) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  return after ? after.start : -1;
}

/** Metindeki konumu tekrar (düğüm + ofset) çiftine çevirir. */
function pointAt(segments: Segment[], pos: number, side: "start" | "end") {
  const seg =
    side === "start"
      ? segments.find((s) => pos >= s.start && pos < s.start + s.node.length)
      : segments.findLast((s) => pos > s.start && pos <= s.start + s.node.length);
  return seg ? { node: seg.node, offset: pos - seg.start } : null;
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** Seçimin iki ucunu kelime sınırlarına kadar uzatır; satır sonu tirelemesini de aşar. */
function expandToWords(text: string, start: number, end: number) {
  // Kenarlardaki boşluk ve noktalama seçime dahil olmasın
  while (start < end && !isWordChar(text[start])) start++;
  while (end > start && !isWordChar(text[end - 1])) end--;
  if (start >= end) return null;

  for (;;) {
    if (isWordChar(text[start - 1])) start--;
    // "embel- lishment" → satır başındaki parçadan önceki satıra geç
    else if (/\p{L}-\s+$/u.test(text.slice(Math.max(0, start - 6), start)) && /\p{Ll}/u.test(text[start])) {
      start = text.lastIndexOf("-", start - 1);
    } else break;
  }
  for (;;) {
    if (isWordChar(text[end])) end++;
    else {
      const m = /^-\s+(?=\p{Ll})/u.exec(text.slice(end, end + 6));
      if (m && isWordChar(text[end - 1])) end += m[0].length;
      else break;
    }
  }
  return { start, end };
}

const joinHyphenation = (s: string) => s.replace(/(\p{L})-\s+(?=\p{Ll})/gu, "$1");

function cleanWord(raw: string) {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// Noktadan sonra cümle bitmeyen kısaltmalar
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "st", "mt", "jr", "sr", "prof", "gen", "col", "capt", "lt",
  "rev", "vol", "ch", "p", "pp", "no", "fig", "cf", "vs", "etc", "ca", "e.g", "i.e",
]);

// Cümle sonu: . ! ? + isteğe bağlı kapanış tırnağı/parantez + isteğe bağlı dipnot numarası
// ("twelve.57 He protested" gibi), ardından boşluk ya da metin sonu.
const BOUNDARY = /[.!?]+["'”’)\]]*\d{0,3}(?=\s|$)/g;
const FOOTNOTE_MARK = /([.!?]+["'”’)\]]*)\d{1,3}(?=\s|$)/g;

function sentenceAround(text: string, start: number, end: number) {
  let s = Math.max(0, start - MAX_SENTENCE_LENGTH);
  let e = Math.min(text.length, end + MAX_SENTENCE_LENGTH);

  for (const m of text.matchAll(BOUNDARY)) {
    const before = text.slice(0, m.index).match(/(\S+)$/)?.[1] ?? "";
    // "Dr." ve "J. Smith" gibi kısaltma/baş harfleri cümle sonu sayma
    if (m[0][0] === "." && (ABBREVIATIONS.has(before.toLowerCase()) || /^\p{Lu}$/u.test(before))) {
      continue;
    }
    const boundaryEnd = m.index + m[0].length;
    if (boundaryEnd <= start) s = Math.max(s, boundaryEnd);
    else if (boundaryEnd >= end) {
      e = Math.min(e, boundaryEnd);
      break;
    }
  }

  return text
    .slice(s, e)
    .replace(/^\s*\d{1,3}(?=\s)/, "") // önceki cümleden kalan dipnot numarası
    .replace(FOOTNOTE_MARK, "$1")
    .replace(/-\s+(?=\p{Ll})/gu, "") // satır sonu tirelemesini birleştir
    .replace(/\s+/g, " ")
    .trim();
}

type Box = { left: number; top: number; right: number; bottom: number };

/**
 * Vurgu için: seçimin her sayfadaki satır dikdörtgenleri (sayfaya oranla) ve metni.
 * Yalnızca metin düğümlerinin dikdörtgenleri alınır; pdf.js'in görünmez yardımcı
 * elemanları (ör. .endOfContent) vurguya karışmasın. Birden fazla sayfaya taşan seçim
 * sayfa başına ayrı vurgu olur.
 */
export function selectionHighlights(selection: Selection) {
  if (selection.rangeCount === 0 || selection.isCollapsed) return [];
  const range = selection.getRangeAt(0);
  const root = range.commonAncestorContainer;
  const pages = new Map<HTMLElement, { page: number; boxes: Box[]; text: string }>();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] =
    root.nodeType === Node.TEXT_NODE ? [root as Text] : [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

  for (const node of nodes) {
    if (!range.intersectsNode(node)) continue;
    const layer = node.parentElement?.closest(".textLayer, .ocr-layer");
    // Yakınlaştırırken arkada hazırlanan görünmez katmanı atla
    if (!layer || layer.closest("[aria-hidden]")) continue;
    const frame = layer.closest<HTMLElement>(".page-frame");
    const fig = frame?.closest<HTMLElement>("[data-page-number]");
    if (!frame || !fig) continue;

    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    if (part.collapsed) continue;

    let entry = pages.get(frame);
    if (!entry) pages.set(frame, (entry = { page: Number(fig.dataset.pageNumber), boxes: [], text: "" }));
    entry.text += part.toString() + " ";
    for (const r of part.getClientRects()) {
      if (r.width > 0.5 && r.height > 0.5) entry.boxes.push(r);
    }
  }

  return [...pages].flatMap(([frame, { page, boxes, text }]) => {
    const f = frame.getBoundingClientRect();
    const rects = mergeLines(boxes).flatMap((b) => [
      +((b.left - f.left) / f.width).toFixed(4),
      +((b.top - f.top) / f.height).toFixed(4),
      +((b.right - b.left) / f.width).toFixed(4),
      +((b.bottom - b.top) / f.height).toFixed(4),
    ]);
    const clean = joinHyphenation(text).replace(/\s+/g, " ").trim();
    return rects.length && clean ? [{ page, rects, text: clean }] : [];
  });
}

/** Aynı satırdaki bitişik parçaları tek dikdörtgende birleştirir. */
function mergeLines(boxes: Box[]) {
  const sorted = [...boxes].sort((a, b) => a.top - b.top || a.left - b.left);
  const out: Box[] = [];
  for (const b of sorted) {
    const line = out.find((o) => {
      const overlap = Math.min(o.bottom, b.bottom) - Math.max(o.top, b.top);
      const h = Math.min(o.bottom - o.top, b.bottom - b.top);
      const gap = Math.max(b.left - o.right, o.left - b.right);
      return overlap >= h * 0.5 && gap <= h;
    });
    if (line) {
      line.left = Math.min(line.left, b.left);
      line.right = Math.max(line.right, b.right);
      line.top = Math.min(line.top, b.top);
      line.bottom = Math.max(line.bottom, b.bottom);
    } else out.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
  }
  return out;
}

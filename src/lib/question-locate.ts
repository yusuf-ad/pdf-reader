import type { PageLayout, Piece } from "./marks";

// Modelin çözdüğü sorunun sayfadaki yeri: soru numarası, doğru şık ve not için boş alan.
// Model koordinat vermez; burada sayfanın metin parçalarından (pdf.js ya da OCR) bulunur.
// Tüm değerler sayfaya oranlıdır (0–1).

export type QuestionSpot = {
  /** x, y, genişlik, yükseklik, … (Highlight.rects biçiminde) */
  number: number[];
  numberText: string;
  option: number[];
  optionText: string;
  note: { x: number; y: number; width: number };
};

// Not boşlukları: sağda en az bu kadar genişlik, altta en az bu kadar yükseklik
const MIN_RIGHT = 0.16;
const MIN_BELOW = 0.03;
const GAP = 0.012;
// Soru bloğunun bulunamazsa en fazla uzunluğu (karakter)
const MAX_BLOCK = 1500;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Düz metindeki yeri içeren parça. */
const pieceAt = (layout: PageLayout, i: number) =>
  layout.pieces.find((p) => i >= p.start && i < p.start + p.text.length);

/** Soru numarası "12.", "12)", "12-", "Soru 12" biçimlerinde; satır başındakiler öncelikli. */
function findQuestion(layout: PageLayout, number: string, from = 0) {
  const n = escapeRe(number);
  const re = new RegExp(`(?:^|\\s)(soru\\s*${n}(?![\\p{L}\\p{N}])|${n}(?=\\s*[.)\\-]))`, "giu");
  let first: { start: number; end: number } | null = null;
  for (const m of layout.text.matchAll(re)) {
    if (m.index < from) continue;
    const start = m.index + m[0].indexOf(m[1]);
    const hit = { start, end: start + m[1].length };
    const piece = pieceAt(layout, start);
    // Parçanın başındaysa (önünde yalnızca boşluk) büyük ihtimalle soru numarasıdır
    if (piece && !piece.text.slice(0, start - piece.start).trim()) {
      if (isLineStart(layout, piece)) return hit;
      first ??= hit;
    } else first ??= hit;
  }
  return first;
}

/**
 * [from, to) aralığını metnin yukarı sıçradığı (yan sütun) ya da satırlar arasında
 * `gapLines` satır yüksekliğinden fazla boşluk olduğu yerde keser.
 */
function cutAtBreak(layout: PageLayout, from: number, to: number, gapLines: number) {
  let prev: Piece | undefined;
  for (const p of layout.pieces) {
    if (p.start + p.text.length <= from || !p.text.trim()) continue;
    if (p.start >= to) break;
    if (prev && p.start > from) {
      const lineHeight = prev.y1 - prev.y0;
      if (p.y1 < prev.y0 || p.y0 - prev.y1 > gapLines * lineHeight) return p.start;
    }
    prev = p;
  }
  return to;
}

/** Bölüm başlığının metindeki yeri (büyük/küçük harf ve boşluk farkı yok sayılır); yoksa 0. */
function sectionStart(layout: PageLayout, section?: string | null) {
  const words = section?.trim().split(/\s+/).filter(Boolean);
  if (!words?.length) return 0;
  const m = new RegExp(words.map(escapeRe).join("\\s*"), "iu").exec(layout.text);
  return m ? m.index + m[0].length : 0;
}

/** Parçanın solunda aynı satırda başka parça yoksa satır başıdır. */
function isLineStart(layout: PageLayout, piece: Piece) {
  const h = piece.y1 - piece.y0;
  return !layout.pieces.some(
    (p) => p !== piece && p.x1 <= piece.x0 + 0.002 && piece.x0 - p.x1 < 0.05 && Math.abs(p.y1 - piece.y1) < h / 2,
  );
}

/** [from, to) aralığındaki metnin kutuları; aynı satırdakiler birleşir. */
export function rangeRects(layout: PageLayout, from: number, to: number) {
  const lines: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const p of layout.pieces) {
    const a = Math.max(from, p.start) - p.start;
    const b = Math.min(to, p.start + p.text.length) - p.start;
    if (b <= a || !p.text.slice(a, b).trim()) continue;
    // Harfler eşit genişlikte sayılır
    const w = (p.x1 - p.x0) / (p.text.length || 1);
    const box = { x0: p.x0 + a * w, x1: p.x0 + b * w, y0: p.y0, y1: p.y1 };
    const line = lines.find((l) => Math.abs((l.y0 + l.y1) / 2 - (box.y0 + box.y1) / 2) < (box.y1 - box.y0) / 2);
    if (line) {
      line.x0 = Math.min(line.x0, box.x0);
      line.x1 = Math.max(line.x1, box.x1);
      line.y0 = Math.min(line.y0, box.y0);
      line.y1 = Math.max(line.y1, box.y1);
    } else lines.push(box);
  }
  // Vurgu harflerin biraz dışına taşsın
  const pad = 0.002;
  return lines.flatMap((l) => [l.x0 - pad, l.y0 - pad, l.x1 - l.x0 + 2 * pad, l.y1 - l.y0 + 2 * pad]);
}

/** Soru bloğunda doğru şıkkın aralığı: "C)" / "C." ile başlar, sonraki şıkta biter. */
function findOption(layout: PageLayout, from: number, to: number, letter: string, text: string) {
  const block = layout.text.slice(from, to);
  const L = letter.trim().charAt(0);
  if (L) {
    const re = new RegExp(`(?:^|[\\s(])([${escapeRe(L.toLocaleUpperCase("tr"))}${escapeRe(L.toLocaleLowerCase("tr"))}]\\s*[).])`, "u");
    const m = re.exec(block);
    if (m) {
      const start = m.index + m[0].indexOf(m[1]);
      const next = String.fromCharCode(L.toUpperCase().charCodeAt(0) + 1);
      const nextRe = new RegExp(`(?:^|[\\s(])[${next}${next.toLowerCase()}]\\s*[).]`, "u");
      const rest = block.slice(start + m[1].length);
      const end = nextRe.exec(rest);
      const stop = start + m[1].length + (end ? end.index : rest.length);
      return { start: from + start, end: from + Math.min(stop, start + 400) };
    }
  }
  // Harf bulunamazsa şıkkın metni aranır (ilk kelimeleri, büyük/küçük harf ve boşluk farkı yok sayılarak)
  const needle = text.trim().split(/\s+/).slice(0, 6).map(escapeRe).join("\\s+");
  if (!needle) return null;
  const m = new RegExp(needle, "iu").exec(block);
  return m ? { start: from + m.index, end: from + m.index + m[0].length } : null;
}

/**
 * Soru numarasını, doğru şıkkı ve sorunun yanında not yazılacak boşluğu bulur.
 * Soru bulunamazsa null. Şık bulunamazsa option boş kalır.
 */
export function locateQuestion(
  layout: PageLayout,
  q: { number: string; section?: string | null; correct: string; correctText: string },
  noteSize: number,
  aspect: number,
): QuestionSpot | null {
  const number = q.number.replace(/[^\p{L}\p{N}]/gu, "");
  if (!number) return null;
  // Numaralar tekrar ediyorsa (Test 1, Test 2) bölüm başlığından sonra aranır
  const head = findQuestion(layout, number, sectionStart(layout, q.section));
  if (!head) return null;
  const nextNumber = /^\d+$/.test(number) ? String(+number + 1) : null;
  const next = nextNumber ? findQuestion(layout, nextNumber, head.end) : null;
  let blockEnd = Math.min(next?.start ?? layout.text.length, head.start + MAX_BLOCK);
  // Metin yukarı sıçrarsa yan sütuna geçilmiştir; büyük bir boşluk varsa soru bitmiştir
  blockEnd = cutAtBreak(layout, head.start, blockEnd, 3);

  const found = findOption(layout, head.end, blockEnd, q.correct, q.correctText);
  // Şık kendi satırında (ve alttaki devam satırlarında) biter
  const option = found && { start: found.start, end: cutAtBreak(layout, found.start, found.end, 0.8) };
  const block = layout.pieces.filter((p) => p.start + p.text.length > head.start && p.start < blockEnd && p.text.trim());
  if (!block.length) return null;
  const bx0 = Math.min(...block.map((p) => p.x0));
  const bx1 = Math.max(...block.map((p) => p.x1));
  const by0 = Math.min(...block.map((p) => p.y0));
  const by1 = Math.max(...block.map((p) => p.y1));

  return {
    number: rangeRects(layout, head.start, head.end),
    numberText: layout.text.slice(head.start, head.end),
    option: option ? rangeRects(layout, option.start, option.end) : [],
    optionText: option ? layout.text.slice(option.start, option.end).replace(/\s+/g, " ").trim() : "",
    note: noteSpot(layout, block, { bx0, bx1, by0, by1 }, noteSize, aspect),
  };
}

/**
 * Not için boşluk: önce sorunun sağı (çift sütunda yandaki sütuna kadar), sonra altı
 * (sonraki soruya kadar), ikisi de dar ise sayfanın sağ kenarı.
 */
function noteSpot(
  layout: PageLayout,
  block: Piece[],
  b: { bx0: number; bx1: number; by0: number; by1: number },
  size: number,
  aspect: number,
) {
  const others = layout.pieces.filter((p) => !block.includes(p) && p.text.trim());
  // Sağdaki ilk engel: aynı yükseklikte, bloğun sağında başlayan metin
  const rightEdge = Math.min(
    0.97,
    ...others.filter((p) => p.y1 > b.by0 && p.y0 < b.by1 && p.x0 >= b.bx1 - 0.002).map((p) => p.x0),
  );
  const right = rightEdge - b.bx1 - 2 * GAP;
  if (right >= MIN_RIGHT) return { x: b.bx1 + GAP, y: b.by0, width: right };

  // Altındaki ilk engel: bloğun sütununda, altında başlayan metin
  const below = Math.min(
    0.97,
    ...others.filter((p) => p.y0 >= b.by1 && p.x1 > b.bx0 && p.x0 < b.bx1).map((p) => p.y0),
  );
  // Bir satırlık notun yüksekliği (y sayfa yüksekliğine oranlı; boyut genişliğe oranlı)
  const lineHeight = size * 1.3 * aspect;
  if (below - b.by1 >= Math.max(MIN_BELOW, lineHeight + GAP)) {
    return { x: b.bx0, y: b.by1 + GAP / 2, width: b.bx1 - b.bx0 };
  }
  return { x: Math.max(b.bx1 + GAP / 2, 0.8), y: b.by0, width: Math.max(0.17, 0.98 - Math.max(b.bx1 + GAP / 2, 0.8)) };
}

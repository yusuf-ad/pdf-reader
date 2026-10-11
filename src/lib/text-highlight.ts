import type { PageProps } from "react-pdf";

type TextRenderer = NonNullable<PageProps["customTextRenderer"]>;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * PDF metin katmanında arama sonuçlarını ve daha önce kaydedilen kelimeleri işaretler.
 * Bir eşleşme metin katmanında iki ayrı parçaya bölünmüşse işaretlenmez.
 */
export function makeTextRenderer(query: string, vocabulary: string[]): TextRenderer | undefined {
  const parts: string[] = [];
  if (query) parts.push(`(?<q>${escapeRe(query)})`);
  if (vocabulary.length) {
    const words = vocabulary.map(escapeRe).join("|");
    parts.push(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`);
  }
  if (!parts.length) return undefined;

  const re = new RegExp(parts.join("|"), "giu");
  return ({ str }) => {
    let out = "";
    let last = 0;
    for (const m of str.matchAll(re)) {
      out += escapeHtml(str.slice(last, m.index));
      out += `<mark class="${m.groups?.q ? "hl-search" : "hl-vocab"}">${escapeHtml(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
    return out + escapeHtml(str.slice(last));
  };
}

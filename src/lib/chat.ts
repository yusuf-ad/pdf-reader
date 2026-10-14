import type { UIDataTypes, UIMessage } from "ai";
import type { QuizTools } from "./quiz";
import type { SkillRequest } from "./skills";

/** Sohbete eklenen PDF bölümü. */
export type Reference = {
  text: string;
  /** Tek kelime/kısa ifade seçildiyse içinde geçtiği cümle */
  sentence?: string;
  page: number | null;
  fileName: string | null;
  /** Modelin bağlamı görebilmesi için seçimin bulunduğu sayfanın tüm metni */
  pageText?: string;
};

export type ChatMessage = UIMessage<{ reference?: Reference; skill?: SkillRequest }, UIDataTypes, QuizTools>;

export function formatReference(ref: Reference) {
  const where = [ref.fileName, ref.page && `sayfa ${ref.page}`].filter(Boolean).join(", ");
  return [
    `<secili_metin kaynak="${where}">`,
    ref.text,
    "</secili_metin>",
    ref.sentence && ref.sentence !== ref.text ? `<cumle>${ref.sentence}</cumle>` : "",
    ref.pageText ? `<sayfa_metni>\n${ref.pageText}\n</sayfa_metni>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const SUGGESTIONS_OPEN = "<oneriler>";
export const SUGGESTIONS_CLOSE = "</oneriler>";

/**
 * Cevabın sonundaki öneri sorularını ayırır. Akış sırasında yarım gelmiş etiket
 * ("<oner…") de metinden atılır, böylece ekranda görünmez.
 */
export function splitSuggestions(text: string) {
  const start = text.indexOf(SUGGESTIONS_OPEN);
  if (start < 0) {
    const partial = text.match(/<[a-z]*$/);
    const body = partial && SUGGESTIONS_OPEN.startsWith(partial[0]) ? text.slice(0, partial.index) : text;
    return { body: body.trimEnd(), suggestions: [] as string[] };
  }
  const end = text.indexOf(SUGGESTIONS_CLOSE, start);
  const suggestions =
    end < 0
      ? []
      : text
          .slice(start + SUGGESTIONS_OPEN.length, end)
          .split("\n")
          .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
          .filter(Boolean)
          .slice(0, 3);
  return { body: text.slice(0, start).trimEnd(), suggestions };
}

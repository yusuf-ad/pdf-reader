import type { UIDataTypes, UIMessage } from "ai";
import type { MemoryTools } from "./memory";
import type { MarkTools } from "./page-marks";
import type { NoteTools } from "./page-notes";
import type { QuizTools } from "./quiz";
import type { SkillRequest } from "./skills";
import type { WordTools } from "./words";

/** HTTP JSON errors and AI SDK stream errors use the same public codes. */
export function clientAiErrorCode(error: unknown): "missing_api_key" | "invalid_api_key" | "rate_limited" | "ai_error" | null {
  const message = error instanceof Error ? error.message : error;
  let code = message;
  if (typeof message === "string") {
    try {
      code = (JSON.parse(message) as { error?: unknown })?.error ?? message;
    } catch {
      // Stream errors contain the code directly instead of a JSON body.
    }
  }
  return code === "missing_api_key" || code === "invalid_api_key" || code === "rate_limited" || code === "ai_error"
    ? code
    : null;
}

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

export type ChatMessage = UIMessage<{
  reference?: Reference;
  skill?: SkillRequest;
  /** Soru sorulurken bağlama eklenen açık sayfa (chip kaldırıldıysa yok) */
  page?: number;
}, UIDataTypes, QuizTools & MemoryTools & WordTools & MarkTools & NoteTools>;

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
export function splitSuggestions(raw: string) {
  // Modelin web aramasından kalan kaynak işaretleri (özel karakterli "cite turn0…") ekranda kutu olarak görünür
  const text = raw.replace(/\uE200[^\uE201]*\uE201/g, "").replace(/[\uE200-\uE202]/g, "");
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

/**
 * Modelin internette arama adımı (OpenAI web_search, sunucuda çalışır). Mesaj tipinde yer
 * almadığı için türe göre tanınır.
 */
export const isWebSearchPart = (p: { type: string }) => p.type === "tool-web_search";

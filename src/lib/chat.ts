import type { UIMessage } from "ai";

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

export type ChatMessage = UIMessage<{ reference?: Reference }>;

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

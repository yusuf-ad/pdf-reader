// Sohbetten sayfadaki yazı notuna ekleme (generative UI): model `writeNote` aracını çağırır,
// eklenecek metin aracın girdisidir. Notu istemci yazar: verilen nota satır olarak ekler ya da
// sayfada yeni bir not açar. Şema istemci ve sunucu arasında ortaktır (mesaj tipleri buradan çıkarılır).
import { tool, type InferUITools } from "ai";
import { z } from "zod";

export const noteInputSchema = z.object({
  page: z.number().int().describe("Notun bulunduğu (yeni not açılacaksa yazılacağı) sayfa"),
  noteId: z
    .string()
    .nullable()
    .describe("Eklenecek mevcut notun kimliği, <isaretler> içinde [not: …] olarak yazar; yeni not açılacaksa null"),
  text: z
    .string()
    .describe(
      "Nota eklenecek metin, düz yazı (markdown yok; kalın/başlık işareti kullanma). Her madde ayrı satırda; numaralı listeye devam ediyorsan numarayı notun son maddesinden sürdür",
    ),
});

export type NoteInput = z.infer<typeof noteInputSchema>;

export const noteTools = {
  writeNote: tool({
    description:
      "Kullanıcı bir şeyin (kelimeler, açıklama, özet…) sayfadaki yazı notuna eklenmesini ya da sayfaya not yazılmasını istediğinde çağrılır. Notu istemci yazar.",
    inputSchema: noteInputSchema,
    // Not istemcide yazılır; modele yalnızca isteğin alındığı bildirilir
    execute: async ({ page }) => ({ page }),
  }),
};

export type NoteTools = InferUITools<typeof noteTools>;

const NUMBERED = /^(\s*)(\d+)([.)])\s+/;

/**
 * Metni notun sonuna yeni satırlarla ekler. Not numaralı listeyle bitiyorsa eklenen numaralı
 * satırlar oradan devam edecek şekilde yeniden numaralanır (ör. 1–2 varsa eklenenler 3, 4…).
 */
export function appendToNote(old: string, add: string) {
  const base = old.replace(/\s+$/, "");
  const lines = add.replace(/\s+$/, "").split("\n");
  if (!base) return lines.join("\n");
  const last = base.split("\n").findLast((l) => NUMBERED.test(l))?.match(NUMBERED);
  if (last) {
    let n = +last[2];
    for (let i = 0; i < lines.length; i++) {
      if (NUMBERED.test(lines[i])) lines[i] = lines[i].replace(NUMBERED, (_, sp) => `${sp}${++n}${last[3]} `);
    }
  }
  return `${base}\n${lines.join("\n")}`;
}

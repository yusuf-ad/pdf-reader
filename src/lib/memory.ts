// Hafıza: kullanıcı hakkında kalıcı bilgiler (hedef, seviye, cevap tercihleri). Tüm kitaplarda
// ortaktır ve her istekte sistem mesajına eklenir. Model `updateMemory` aracıyla ekler, siler,
// günceller. Araç sunucuda yalnızca değişiklikleri hesaplar; kaydı istemci yapar (veri yerelde).
// Bu dosya istemci ve sunucu arasında ortaktır (mesaj tipleri buradan çıkarılır).
import { tool, type InferUITools } from "ai";
import { z } from "zod";

export const MEMORY_MAX_ITEMS = 50;
export const MEMORY_MAX_CHARS = 200;

export type MemoryItem = { id: string; text: string };

/** Hafızadaki tek değişiklik; `previous` geri almak için eski metindir. */
export type MemoryChange =
  | { action: "add"; id: string; text: string }
  | { action: "remove"; id: string; previous: string }
  | { action: "update"; id: string; text: string; previous: string };

export const newMemoryId = () => Math.random().toString(36).slice(2, 8);

const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MEMORY_MAX_CHARS);

/** İstekle gelen hafızayı doğrular (istemciden gelen her şeye güvenilmez). */
export function sanitizeMemory(value: unknown): MemoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((m): m is MemoryItem => typeof m?.id === "string" && typeof m?.text === "string")
    .slice(0, MEMORY_MAX_ITEMS)
    .map((m) => ({ id: m.id.slice(0, 20), text: clean(m.text) }))
    .filter((m) => m.text);
}

export function formatMemory(items: MemoryItem[]) {
  const list = items.length ? items.map((m) => `- [${m.id}] ${m.text}`).join("\n") : "(boş)";
  return `<hafiza dolu="${items.length}/${MEMORY_MAX_ITEMS}">\n${list}\n</hafiza>`;
}

const memoryInputSchema = z.object({
  changes: z
    .array(
      z.object({
        action: z.enum(["add", "remove", "update"]),
        id: z.string().optional().describe("Silinecek/güncellenecek maddenin id'si (<hafiza> içindeki [id]); eklemede boş"),
        text: z
          .string()
          .optional()
          .describe(`Eklenecek ya da yeni metin; kısa, üçüncü şahıs, en fazla ${MEMORY_MAX_CHARS} karakter. Ör. 'KPSS'ye hazırlanıyor'`),
      }),
    )
    .describe("Yapılacak değişiklikler"),
});

/** Araç, istekteki güncel hafızaya göre değişiklikleri hesaplar ve sınırları uygular. */
export function memoryTools(items: MemoryItem[]) {
  return {
    updateMemory: tool({
      description:
        "Kullanıcı hakkında kalıcı bilgiyi hafızaya ekler, siler ya da günceller. Yalnızca sonraki sohbetlerde de işe yarayacak bilgiler için: hedefi, seviyesi, alanı, cevap tercihleri (uzunluk, dil, örnek tarzı). Kullanıcı 'hatırla' derse her zaman kaydet, 'unut' derse sil. Tek seferlik soruları, kitabın içeriğini ve hassas kişisel bilgileri (sağlık, adres, kimlik vb.) kaydetme. Zaten kayıtlı olanı tekrar ekleme; değişen bilgiyi güncelle. Hafıza doluysa benzer maddeleri birleştir. Araç sonucunu kullanıcıya ayrıca anlatma; arayüz gösterir.",
      inputSchema: memoryInputSchema,
      execute: async ({ changes }) => {
        const current = new Map(items.map((m) => [m.id, m.text]));
        const applied: MemoryChange[] = [];
        const errors: string[] = [];
        for (const c of changes) {
          const text = clean(c.text ?? "");
          const previous = c.id ? current.get(c.id) : undefined;
          if (c.action === "add") {
            if (!text) continue;
            if (current.size >= MEMORY_MAX_ITEMS) {
              errors.push("Hafıza dolu; önce benzer maddeleri birleştir.");
              continue;
            }
            const id = newMemoryId();
            current.set(id, text);
            applied.push({ action: "add", id, text });
          } else if (previous === undefined) {
            errors.push(`'${c.id}' id'li madde yok.`);
          } else if (c.action === "remove") {
            current.delete(c.id!);
            applied.push({ action: "remove", id: c.id!, previous });
          } else if (text && text !== previous) {
            current.set(c.id!, text);
            applied.push({ action: "update", id: c.id!, text, previous });
          }
        }
        return { applied, errors };
      },
    }),
  };
}

export type MemoryTools = InferUITools<ReturnType<typeof memoryTools>>;

/** Değişiklikleri listeye uygular; aynı değişiklik iki kez uygulansa da sonuç değişmez. */
export function applyMemoryChanges(items: MemoryItem[], changes: MemoryChange[]): MemoryItem[] {
  let out = items;
  for (const c of changes) {
    if (c.action === "add") {
      if (!out.some((m) => m.id === c.id)) out = [...out, { id: c.id, text: c.text }];
    } else if (c.action === "remove") out = out.filter((m) => m.id !== c.id);
    else out = out.map((m) => (m.id === c.id ? { ...m, text: c.text } : m));
  }
  return out.slice(0, MEMORY_MAX_ITEMS);
}

/** Değişiklikleri geri alır (tersine, sondan başa). */
export function revertMemoryChanges(items: MemoryItem[], changes: MemoryChange[]): MemoryItem[] {
  let out = items;
  for (const c of [...changes].reverse()) {
    if (c.action === "add") out = out.filter((m) => m.id !== c.id);
    else if (c.action === "remove") {
      if (!out.some((m) => m.id === c.id)) out = [...out, { id: c.id, text: c.previous }];
    } else out = out.map((m) => (m.id === c.id ? { ...m, text: c.previous } : m));
  }
  return out;
}

/** Değişiklik hâlâ hafızada mı (geri alınmadı ya da sonradan değiştirilmedi mi). */
export function isChangeActive(items: MemoryItem[], c: MemoryChange) {
  const item = items.find((m) => m.id === c.id);
  return c.action === "remove" ? !item : item?.text === c.text;
}

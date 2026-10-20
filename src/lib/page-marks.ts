// Yanlış yapılan soruları sayfada işaretleme (generative UI): model `markQuestions` aracını çağırır,
// çözdüğü sorular aracın girdisidir. Konumları model vermez; istemci soru numarasını ve şıkkı
// sayfanın metin konumlarında bulur, asistan imleciyle sarı/yeşil vurgu ve not ekler.
// Şema istemci ve sunucu arasında ortaktır (mesaj tipleri buradan çıkarılır).
import { tool, type InferUITools } from "ai";
import { z } from "zod";

export const markInputSchema = z.object({
  page: z.number().int().describe("Soruların bulunduğu sayfa"),
  checked: z
    .number()
    .int()
    .nullable()
    .describe("Kontrolde: kullanıcının cevapladığı (şık işaretlediği) soru sayısı. Kullanıcı yanlışlarını kendisi söylediyse null"),
  questions: z
    .array(
      z.object({
        number: z.string().describe("Soru numarası, metinde yazdığı gibi, ör. '12'"),
        section: z
          .string()
          .nullable()
          .describe(
            "Sayfada birden fazla test/bölüm varsa sorunun altında bulunduğu başlık, sayfada yazdığı gibi (ör. 'TEST 10'); tek bölüm varsa null",
          ),
        occurrence: z
          .number()
          .int()
          .nullable()
          .describe(
            "Bu numara sayfada birden fazla soruda geçiyorsa bu soru okuma sırasına göre kaçıncısı (1 = ilk; iki sütunda önce sol sütun yukarıdan aşağı); tek geçiyorsa null",
          ),
        chosen: z.string().nullable().describe("Kontrolde: kullanıcının işaretlediği şıkkın harfi; bilinmiyorsa null"),
        correct: z.string().describe("Doğru şıkkın harfi, ör. 'C'"),
        correctText: z.string().describe("Doğru şıkkın metni, sayfadan aynen"),
        note: z.string().describe("Sayfaya yazılacak kısa Türkçe not (en fazla 2 cümle): neden doğru, tuzak neydi"),
      }),
    )
    .describe("Yalnızca yanlış yapılan sorular (çözülmüş); hepsi doğruysa boş"),
});

export type MarkInput = z.infer<typeof markInputSchema>;
export type MarkedQuestion = MarkInput["questions"][number];

export const markTools = {
  markQuestions: tool({
    description:
      "Kullanıcı yanlış yaptığı soruların sayfada işaretlenmesini istediğinde çağrılır: soru numarası sarıyla, doğru şık yeşille işaretlenir ve yanına not yazılır. İşaretleri istemci ekler.",
    inputSchema: markInputSchema,
    // İşaretler istemcide eklenir; modele yalnızca kaç soru verildiği bildirilir
    execute: async ({ questions }) => ({ marked: questions.length }),
  }),
};

export type MarkTools = InferUITools<typeof markTools>;

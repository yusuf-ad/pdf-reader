// PDF içeriğinden test (generative UI): model `createQuiz` aracını çağırır, testin kendisi
// aracın girdisidir. Sohbet bu girdiyi akarken tıklanabilir bir test kartı olarak çizer.
// Şema istemci ve sunucu arasında ortaktır (mesaj tipleri buradan çıkarılır).
import { tool, type InferUITools } from "ai";
import { z } from "zod";

export const quizInputSchema = z.object({
  title: z.string().describe("Testin kısa başlığı, ör. 'Adverbial Clauses — s. 12–18'"),
  questions: z
    .array(
      z.object({
        question: z.string().describe("Soru kökü; tek başına anlaşılır olsun"),
        options: z
          .array(z.string())
          .describe("Tam 4 şık. Şıkların başına A), B) gibi harf koyma."),
        answer: z.number().int().describe("Doğru şıkkın sırası (0'dan başlar)"),
        explanation: z
          .string()
          .describe("Doğru cevabın neden doğru olduğunu 1-2 cümleyle açıkla; şıkları harfle anma"),
        page: z.number().int().nullable().describe("Sorunun dayandığı sayfa; bilinmiyorsa null"),
      }),
    )
    .describe("Sorular"),
});

export type QuizInput = z.infer<typeof quizInputSchema>;
export type QuizQuestion = QuizInput["questions"][number];

export const quizTools = {
  createQuiz: tool({
    description:
      "Kullanıcı test, quiz, soru çözmek ya da kendini sınamak istediğinde okuduğu PDF'in içeriğinden çoktan seçmeli test oluşturur. Test bu aracın girdisidir; soruları ayrıca metin olarak yazma.",
    inputSchema: quizInputSchema,
    // Test istemcide çizilir; modele yalnızca oluşturulduğu bildirilir
    execute: async ({ questions }) => ({ created: questions.length }),
  }),
};

export type QuizTools = InferUITools<typeof quizTools>;

/** Şıkları karıştırmak için küçük, tohumlu rastgele sayı üreteci. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Modeller doğru cevabı çoğunlukla ilk şıklara koyar; şıklar her soru için sabit bir sırayla
 * (aynı test her çizimde aynı görünsün diye tohumlu) karıştırılır.
 * Dönen `order[i]`: ekrandaki i. şıkkın orijinal sırası.
 */
export function shuffledOrder(seed: string, count: number) {
  const rand = seeded(seed);
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

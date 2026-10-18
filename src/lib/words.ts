// Sohbetten kelime listesine toplu ekleme (generative UI): model `proposeWords` aracını çağırır,
// önerilen kelimeler aracın girdisidir. Sohbet bunu bir önizleme kartı olarak çizer; kullanıcı
// istediklerini seçip onaylayınca kelime listesine eklenir (hiçbir şey kendiliğinden eklenmez).
// Şema istemci ve sunucu arasında ortaktır (mesaj tipleri buradan çıkarılır).
import { tool, type InferUITools } from "ai";
import { z } from "zod";

export const wordsInputSchema = z.object({
  title: z.string().describe("Listenin kısa başlığı, ör. 'Zıtlık bağlaçları — s. 1–40'"),
  words: z
    .array(
      z.object({
        word: z.string().describe("Metinde geçtiği hâliyle kelime ya da ifade"),
        wordTranslation: z.string().describe("Bu bağlamdaki Türkçe karşılığı"),
        partOfSpeech: z.string().describe("Türü, kısaca: bağlaç, fiil, isim, deyim vb."),
        synonyms: z
          .array(z.string())
          .describe("Eş anlamlıları (aynı dilde); kullanıcı istemediyse ya da yoksa boş"),
        sentence: z.string().describe("Kelimenin geçtiği cümle, metinden aynen; metinde yoksa boş"),
        sentenceTranslation: z.string().describe("Cümlenin Türkçe çevirisi; cümle boşsa boş"),
        page: z.number().int().nullable().describe("Geçtiği sayfa; bilinmiyorsa null"),
      }),
    )
    .describe("Eklenmesi önerilen kelimeler"),
});

export type WordsInput = z.infer<typeof wordsInputSchema>;
export type ProposedWord = WordsInput["words"][number];

export const wordTools = {
  proposeWords: tool({
    description:
      "Kullanıcı kelime/ifadeleri kelime listesine eklemek istediğinde (ör. 'bu PDF'teki zıtlık bağlaçlarını kelimelere ekle') eklenecekleri önerir. Öneriler kullanıcıya önizleme olarak gösterilir, kullanıcı seçip onaylar. Listeyi ayrıca metin olarak yazma.",
    inputSchema: wordsInputSchema,
    // Kart istemcide çizilir, ekleme de orada onayla yapılır; modele yalnızca önerildiği bildirilir
    execute: async ({ words }) => ({ proposed: words.length }),
  }),
};

export type WordTools = InferUITools<typeof wordTools>;

import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";

const requestSchema = z.object({
  word: z.string().trim().min(1).max(200),
  sentence: z.string().trim().max(2000).default(""),
});

const translationSchema = z.object({
  word: z.string().describe("Seçilen kelimenin sözlük (yalın) hali"),
  wordTranslation: z
    .string()
    .describe("Kelimenin bu cümledeki anlamına uygun Türkçe karşılığı"),
  partOfSpeech: z
    .string()
    .describe("Türkçe sözcük türü: isim, fiil, sıfat, zarf, deyim vb."),
  sentenceTranslation: z.string().describe("Cümlenin doğal Türkçe çevirisi"),
});

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY tanımlı değil (.env.local dosyasını kontrol et)." },
      { status: 500 },
    );
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  const { word, sentence } = parsed.data;

  try {
    const { output } = await generateText({
      model: openai(process.env.OPENAI_MODEL || "gpt-6-luna"),
      output: Output.object({ schema: translationSchema }),
      system:
        "Sen deneyimli bir çevirmen ve sözlüksün. Kullanıcı bir PDF okurken bir kelime ya da ifade seçiyor. " +
        "Kelimeyi, geçtiği cümledeki anlamına göre Türkçeye çevir (birden fazla yaygın anlam varsa en uygun 1-3 tanesini virgülle ver). " +
        "Cümleyi de akıcı ve doğal bir Türkçeyle çevir. Cümle verilmemişse sentenceTranslation boş string olsun.",
      prompt: `Kelime/ifade: "${word}"\nCümle: "${sentence}"`,
    });

    return Response.json(output);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return Response.json({ error: `Çeviri başarısız: ${message}` }, { status: 502 });
  }
}

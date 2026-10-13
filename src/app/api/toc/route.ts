import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";

const requestSchema = z.object({
  numPages: z.number().int().positive(),
  sample: z.string().min(1).max(120_000),
});

const tocSchema = z.object({
  found: z.boolean().describe("Metinde basılı bir içindekiler (Contents) sayfası var mı"),
  tocPages: z
    .array(z.number().int())
    .describe("İçindekiler listesinin bulunduğu [s. N] işaretli PDF sayfaları"),
  entries: z.array(
    z.object({
      title: z.string().describe("Başlık, içindekilerde yazdığı gibi (numarasıyla, ör. '3. Functions')"),
      depth: z.number().int().describe("0: kısım/bölüm, 1: alt başlık, 2: daha alt başlık"),
      page: z
        .number()
        .int()
        .nullable()
        .describe("İçindekilerde yazan sayfa numarası (Arap rakamı); roma rakamı veya yoksa null"),
    }),
  ),
});

const SYSTEM = `Bir kitabın ilk sayfalarının metni verilecek; her sayfa [s. N] ile başlar (N: PDF sayfa numarası).
Kitabın basılı içindekiler (Contents / Table of Contents / İçindekiler) listesini bul ve aynen çıkar.

- Yalnızca içindekiler listesinde yazanları al; başlık uydurma, metinden bölüm tahmin etme.
- Sayfa numarası olarak içindekilerde yazan basılı numarayı ver ([s. N] değil).
- Hiyerarşiyi girintiden, numaralandırmadan (1, 1.1, 1.1.1) veya Part/Chapter yapısından çıkar; en fazla 3 seviye.
- İçindekiler birden fazla sayfaya yayılıyorsa hepsini al.
- Basılı içindekiler yoksa found=false, entries boş olsun.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "OPENAI_API_KEY tanımlı değil." }, { status: 500 });
  }
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Geçersiz istek." }, { status: 400 });

  try {
    const { output } = await generateText({
      model: openai(process.env.OPENAI_MODEL || "gpt-6-luna"),
      output: Output.object({ schema: tocSchema }),
      system: SYSTEM,
      prompt: parsed.data.sample,
      abortSignal: req.signal,
    });
    return Response.json(output);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    return Response.json({ error: `İçindekiler çıkarılamadı: ${message}` }, { status: 502 });
  }
}

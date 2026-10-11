import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText } from "ai";
import { formatReference, type ChatMessage } from "@/lib/chat";

export const maxDuration = 60;

const SYSTEM = `Sen bir okuma asistanısın. Kullanıcı bir PDF okuyor (genellikle İngilizce) ve seçtiği bölümler hakkında soru soruyor.

- Seçili metin <secili_metin> içinde, varsa geçtiği cümle <cumle> içinde, o sayfanın tamamı <sayfa_metni> içinde gelir. Sayfa metni yalnızca bağlam içindir.
- Varsayılan olarak Türkçe cevap ver; kullanıcı başka dil isterse ona uy.
- Kısa ve net ol. Kelime/ifade sorularında anlamı, bu bağlamdaki kullanımı ve gerekirse dilbilgisini açıkla.
- Tarihî kişi, olay veya kavram geçiyorsa okumayı kolaylaştıracak kadar arka plan ver.
- Metinde olmayan bir şeyi metindeymiş gibi söyleme; genel bilgini kullandığında bunu belli et.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY tanımlı değil (.env.local dosyasını kontrol et)." },
      { status: 500 },
    );
  }

  const { messages }: { messages: ChatMessage[] } = await req.json();

  // Her soruya, sorulduğu andaki seçili metni ekle
  const withReferences = messages.map((m) =>
    m.role === "user" && m.metadata?.reference
      ? {
          ...m,
          parts: [{ type: "text" as const, text: formatReference(m.metadata.reference) }, ...m.parts],
        }
      : m,
  );

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL || "gpt-4o-mini"),
    system: SYSTEM,
    messages: await convertToModelMessages(withReferences),
  });

  return result.toUIMessageStreamResponse();
}

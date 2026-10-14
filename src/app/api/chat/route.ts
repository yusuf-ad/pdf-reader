import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, generateText, streamText } from "ai";
import {
  formatBookContext,
  PAGE_TEXT_CHARS,
  type BookContext,
} from "@/lib/book-context";
import {
  formatReference,
  splitSuggestions,
  SUGGESTIONS_CLOSE,
  SUGGESTIONS_OPEN,
  type ChatMessage,
} from "@/lib/chat";
import {
  chunkPages,
  formatPages,
  SINGLE_PASS_CHARS,
  skillLabel,
  skillPrompt,
  type SkillRequest,
} from "@/lib/skills";

// Uzun PDF özetleri parça parça yapıldığı için süre sınırı geniş
export const maxDuration = 300;
// Aynı anda özetlenen parça sayısı
const CHUNK_CONCURRENCY = 4;

const SYSTEM = `Sen bir okuma asistanısın. Kullanıcı bir kitap/PDF okuyor ve okuduğu yer hakkında soru soruyor.

- Okunan kitabın künyesi, profili, açık bölüm ve sayfa <kitap> içinde gelir. Cevaplarını bu kitaba göre ver; kitabın terminolojisini, kullandığı dili ve sürümleri esas al.
- Seçili metin <secili_metin> içinde, varsa geçtiği cümle <cumle> içinde, o sayfanın tamamı <sayfa_metni> içinde gelir. Sayfa metni yalnızca bağlam içindir.
- Seçili metin yoksa "bu", "burası", "bu bölüm" gibi ifadeleri <acik_sayfa> ve açık bölüme göre yorumla.
- Cevabı kitabın türüne göre ayarla:
  - Yazılım/teknik kitap: kavramı teknik olarak doğru ve sade açıkla, gerektiğinde kitabın kullandığı dil ve sürümle uyumlu kısa kod örneği ver (kod bloğu içinde), pratikte nerede kullanıldığını ve sık yapılan hataları söyle. Teknik terimlerin İngilizcesini koru, gerekirse Türkçesini parantezle ver.
  - Yabancı dilde edebiyat/genel metin: kelime/ifade sorularında anlamı, bu bağlamdaki kullanımı ve gerekirse dilbilgisini açıkla.
  - Tarih, felsefe vb.: geçen kişi, olay ve kavramlara okumayı kolaylaştıracak kadar arka plan ver.
- Varsayılan olarak Türkçe cevap ver; kullanıcı başka dil isterse ona uy. Kısa ve net ol.
- Metinde olmayan bir şeyi metindeymiş gibi söyleme; genel bilgini kullandığında bunu belli et.
- Kullanıcı görsel (genelde ekran görüntüsü) ekleyebilir. Görseldeki yazıyı dikkatle oku. Soru yoksa: yazıyı aynen aktar, Türkçe çevirisini ver ve kısaca açıkla. Okuyamadığın kısımları uydurma, okunamadığını söyle.
- Her cevabın en sonuna, kullanıcının bir sonraki adımda sorabileceği 3 kısa takip sorusu ekle. Sorular bu cevaba ve kitaba özgü olsun, kullanıcının ağzından yazılsın, her biri en fazla 12 kelime. Tam olarak şu biçimde ve cevabın en sonunda:
${SUGGESTIONS_OPEN}
- soru
- soru
- soru
${SUGGESTIONS_CLOSE}`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      {
        error:
          "OPENAI_API_KEY tanımlı değil (.env.local dosyasını kontrol et).",
      },
      { status: 500 },
    );
  }

  const { messages, book }: { messages: ChatMessage[]; book?: BookContext } =
    await req.json();
  const model = openai(process.env.OPENAI_MODEL || "gpt-6-luna");
  const last = messages.length - 1;

  const withReferences = await Promise.all(
    messages.map(async (m, i) => {
      // Önceki cevaplardaki öneri listeleri modele geri gönderilmez
      if (m.role === "assistant") {
        return {
          ...m,
          parts: m.parts.map((p) =>
            p.type === "text"
              ? { ...p, text: splitSuggestions(p.text).body }
              : p,
          ),
        };
      }
      if (m.role !== "user") return m;
      const skill = m.metadata?.skill;
      if (skill) {
        // Belge metni yalnızca son istekte gönderilir; önceki özetler sohbette zaten varl
        const text =
          i === last
            ? await buildSkillPrompt(skill, model, req.signal)
            : `(${skillLabel(skill)} istendi; cevabı aşağıda.)`;
        return { ...m, parts: [{ type: "text" as const, text }] };
      }
      // Her soruya, sorulduğu andaki seçili metni ekle
      if (m.metadata?.reference) {
        return {
          ...m,
          parts: [
            {
              type: "text" as const,
              text: formatReference(m.metadata.reference),
            },
            ...m.parts,
          ],
        };
      }
      return m;
    }),
  );

  const result = streamText({
    model,
    system: book ? `${SYSTEM}\n\n${bookBlock(book, messages[last])}` : SYSTEM,
    messages: await convertToModelMessages(withReferences),
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse();
}

/** Seçili metin veya skill varsa sayfa metni zaten mesajda; açık sayfa yalnızca serbest sorularda eklenir. */
function bookBlock(book: BookContext, lastMessage: ChatMessage | undefined) {
  const clip = (v: unknown, n: number) =>
    typeof v === "string" ? v.slice(0, n) : null;
  const safe: BookContext = {
    fileName: clip(book.fileName, 300),
    title: clip(book.title, 300),
    author: clip(book.author, 300),
    profile: clip(book.profile, 3000),
    page: Number(book.page) || 1,
    numPages: Number(book.numPages) || 0,
    chapter: clip(book.chapter, 500),
    pageText: clip(book.pageText, PAGE_TEXT_CHARS),
  };
  const free =
    !lastMessage?.metadata?.reference && !lastMessage?.metadata?.skill;
  return formatBookContext(safe, free);
}

/** Kısa belgeyi doğrudan, uzun belgeyi önce parça parça özetleyip gönderir. */
async function buildSkillPrompt(
  skill: SkillRequest,
  model: ReturnType<typeof openai>,
  signal: AbortSignal,
) {
  if (!skill.pages.length)
    return skillPrompt(skill, "(Bu sayfalarda okunabilir metin yok.)", false);
  const full = formatPages(skill.pages);
  if (full.length <= SINGLE_PASS_CHARS) return skillPrompt(skill, full, false);

  const chunks = chunkPages(skill.pages);
  const summaries: string[] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      const pages = chunks[i];
      const range = `s. ${pages[0].page}–${pages[pages.length - 1].page}`;
      const { text } = await generateText({
        model,
        abortSignal: signal,
        system:
          "Bir kitabın/belgenin bir parçasını özetliyorsun; bu özetler sonra birleştirilip tüm belgenin özeti çıkarılacak. Türkçe, madde madde yaz. Bölüm başlıklarını, önemli kişi, olay, kavram ve argümanları koru; ilgili sayfa numaralarını belirt. Metinde olmayanı ekleme.",
        prompt: formatPages(pages),
      });
      summaries[i] = `## ${range}\n${text}`;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker),
  );
  return skillPrompt(skill, summaries.join("\n\n"), true);
}

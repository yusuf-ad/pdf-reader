import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, generateText, hasToolCall, isStepCount, streamText } from "ai";
import {
  formatBookContext,
  MARKS_CHARS,
  PAGE_TEXT_CHARS,
  type BookContext,
} from "@/lib/book-context";
import { formatMemory, memoryTools, sanitizeMemory } from "@/lib/memory";
import { markTools } from "@/lib/page-marks";
import { quizTools } from "@/lib/quiz";
import { wordTools } from "@/lib/words";
import {
  formatReference,
  splitSuggestions,
  SUGGESTIONS_CLOSE,
  SUGGESTIONS_OPEN,
  isWebSearchPart,
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
- web_search aracıyla internette arama yapabilirsin. Güncel bilgi gereken sorularda (bir kursun/ürünün şu anki hâli, son sürümler, tarihler, haberler, değişmiş olabilecek her şey) ya da kullanıcı açıkça "ara", "internette bak", "güncel" derse ara. Cevap kitapta veya genel bilgide zaten varsa arama. Aradıysan bulduğun bilgiyi kaynağına dayandır, kitaptaki bilgiyle çelişiyorsa ikisini de belirt.
- Kullanıcının kitapta işaretlediği yerler <isaretler> içinde gelir: sayfa, renk, işaretin altındaki yazı ve geçtiği yer (işaretli satırdan başlayan metin). "İşaretlediğim", "sarıyla işaretli", "yanlış yaptığım sorular" gibi ifadeleri buna göre yorumla; ör. soru numarası işaretliyse o soru, geçtiği yerde başlayan sorudur. Rengin anlamını kullanıcı söylemediyse varsayma. Geçtiği yer kesik olabilir; eksik kısmı uydurma.
- Kullanıcı görsel (genelde ekran görüntüsü) ekleyebilir. Görseldeki yazıyı dikkatle oku. Soru yoksa: yazıyı aynen aktar, Türkçe çevirisini ver ve kısaca açıkla. Okuyamadığın kısımları uydurma, okunamadığını söyle.
- Kullanıcı test, quiz ya da soru çözmek isterse createQuiz aracını çağır; soruları okuduğu kitabın verilen metnine (<belge>, <sayfa_metni>, <acik_sayfa>, <secili_metin>) dayandır, soruları ayrıca metin olarak yazma. Kaç soru istediğini söylemediyse 5 soru hazırla. Metin yoksa ya da yetersizse test uydurma, bunu söyle.
- Kullanıcı kelime/ifadeleri kelime listesine eklemek isterse proposeWords aracını çağır; kelimeleri verilen metne dayandır, geçtiği cümleyi metinden aynen al. Araç hiçbir şeyi kendisi eklemez: öneriler kullanıcıya önizleme olarak gösterilir, kullanıcı seçip onaylar. Listeyi ayrıca metin olarak yazma.
- Kullanıcı yanlış yaptığı soruların sayfada işaretlenmesini ya da cevaplarının kontrol edilmesini isterse markQuestions aracını çağır; soruları verilen sayfa metninden çöz. Kullanıcının kalemle işaretlediği şıklar sayfa metninde görünmez; sayfa görüntüsü gelmediyse ve kullanıcı işaretlediği cevapları soruyorsa şıklarını yazmasını isteme, "cevaplarımı kontrol et" yazmasını söyle (o zaman sayfa işaretleriyle birlikte görüntü olarak gelir).
- Kullanıcı hakkında kalıcı bilgiler <hafiza> içinde gelir (varsa). Cevaplarını bunlara göre kişiselleştir (seviye, hedef, tercih edilen uzunluk ve tarz); hafızayı her cevapta anma, yalnızca işe yaradığında kullan. Sonraki sohbetlerde de işe yarayacak yeni bir bilgi öğrenirsen ya da kullanıcı "hatırla"/"unut" derse updateMemory aracını çağır, sonra cevabına devam et.
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

  const {
    messages,
    book,
    memory: rawMemory,
  }: { messages: ChatMessage[]; book?: BookContext; memory?: unknown } = await req.json();
  // Hafıza kapalıysa istemci göndermez; o zaman araç da verilmez
  const memory = rawMemory === undefined ? null : sanitizeMemory(rawMemory);
  const model = openai(process.env.OPENAI_MODEL || "gpt-6-luna");
  const last = messages.length - 1;

  const withReferences = await Promise.all(
    messages.map(async (m, i) => {
      // Önceki cevaplardaki öneri listeleri modele geri gönderilmez
      // Önceki web aramaları da geri gönderilmez; cevap metni yeterli
      // Hafıza değişiklikleri de gönderilmez; güncel hafıza sistem mesajında
      if (m.role === "assistant") {
        return {
          ...m,
          parts: m.parts
            .filter((p) => !isWebSearchPart(p) && p.type !== "source-url" && p.type !== "tool-updateMemory")
            .map((p) =>
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
        // Cevap kontrolünde sayfanın işaretli görüntüsü de gider (yalnızca son istekte)
        const files = i === last ? m.parts.filter((p) => p.type === "file") : [];
        return { ...m, parts: [{ type: "text" as const, text }, ...files] };
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

  // Test isteğinde model mutlaka test aracını, kelime isteğinde öneri aracını çağırır
  const skillName = messages[last]?.metadata?.skill?.name;
  const system = [SYSTEM, memory && formatMemory(memory), book && bookBlock(book, messages[last])]
    .filter(Boolean)
    .join("\n\n");
  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(withReferences),
    tools: {
      ...quizTools,
      ...wordTools,
      ...markTools,
      ...(memory ? memoryTools(memory) : {}),
      web_search: openai.tools.webSearch({ searchContextSize: "medium" }),
    },
    toolChoice:
      skillName === "test"
        ? { type: "tool", toolName: "createQuiz" }
        : skillName === "kelime"
          ? { type: "tool", toolName: "proposeWords" }
          : skillName === "isaretle" || skillName === "kontrol"
            ? { type: "tool", toolName: "markQuestions" }
            : "auto",
    // Hafıza kaydından sonra model cevabına devam eder; test, kelime önerisi ya da işaretleme gelince durur (cevabın kendisi)
    stopWhen: [
      isStepCount(3),
      hasToolCall("createQuiz"),
      hasToolCall("proposeWords"),
      hasToolCall("markQuestions"),
    ],
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({ sendSources: true });
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
    marks: clip(book.marks, MARKS_CHARS),
  };
  const free =
    !lastMessage?.metadata?.reference && !lastMessage?.metadata?.skill;
  return formatBookContext(safe, free);
}

const CHUNK_SYSTEM =
  "Bir kitabın/belgenin bir parçasını özetliyorsun; bu özetler sonra birleştirilip tüm belgenin özeti çıkarılacak. Türkçe, madde madde yaz. Bölüm başlıklarını, önemli kişi, olay, kavram ve argümanları koru; ilgili sayfa numaralarını belirt. Metinde olmayanı ekleme.";

/** Kelime aramasında parçalar özetlenmez; isteğe uyan kelimeler cümleleriyle aynen çıkarılır. */
const wordsChunkSystem = (request = "") =>
  `Bir belgenin bir parçasındasın; bulduklarından sonra kelime listesi hazırlanacak. Kullanıcının isteği: "${request.slice(0, 500)}"
Bu parçada isteğe uyan kelime/ifadeleri bul. Her biri için bir satır yaz: kelime | geçtiği cümle (metinden aynen) | sayfa ([s. N] işaretinden). Aynı kelimeyi bir kez yaz. Hiç yoksa yalnızca "yok" yaz. Metinde olmayanı ekleme.`;

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
        system: skill.name === "kelime" ? wordsChunkSystem(skill.request) : CHUNK_SYSTEM,
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

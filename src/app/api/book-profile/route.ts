import { aiErrorCode, getAi, missingKeyResponse } from "@/lib/ai-provider";
import { generateText } from "ai";
import type { ProfileRequest } from "@/lib/book-context";

const SYSTEM = `Kullanıcının okuduğu kitabı tanıyorsun. Sana PDF künyesi, dosya adı, içindekiler ve ilk sayfalar verilecek. Bundan sonra kitapla ilgili her soruda okuma asistanına bağlam olarak verilecek kısa bir kitap profili yaz.

Biçim (Türkçe, en fazla 200 kelime, başka bir şey yazma):
Kitap: <ad> — <yazar> (<baskı/yıl biliniyorsa>)
Tür/alan: <ör. yazılım: backend, Python; roman; tarih; dil öğrenimi>
Konu ve amaç: <1-2 cümle>
Seviye ve okuyucu: <ör. başlangıç, orta düzey geliştirici>
Teknolojiler: <yalnızca teknik kitaplarda: diller, sürümler, kütüphaneler, araçlar>
Ana bölümler: <kısa liste>

Kitabı tanıyorsan genel bilgini kullanabilirsin ama verilen metinle çelişme. Emin olmadığın bilgiyi yazma; künye boş veya anlamsızsa ilk sayfalardan çıkar.`;

export async function POST(req: Request) {
  const ai = getAi(req);
  if (!ai) return missingKeyResponse();
  const b: ProfileRequest = await req.json();
  try {
  const { text } = await generateText({
    model: ai.model,
    providerOptions: ai.providerOptions,
    system: SYSTEM,
    abortSignal: req.signal,
    prompt: [
      `Dosya adı: ${b.fileName ?? "-"}`,
      `Başlık (künye): ${b.title ?? "-"}`,
      `Yazar (künye): ${b.author ?? "-"}`,
      `Sayfa sayısı: ${b.numPages}`,
      `<icindekiler>\n${b.outline.slice(0, 15_000) || "(yok)"}\n</icindekiler>`,
      `<ilk_sayfalar>\n${b.sample.slice(0, 25_000) || "(metin yok)"}\n</ilk_sayfalar>`,
    ].join("\n"),
  });
  return Response.json({ profile: text.trim() });
  } catch (err) {
    const code = aiErrorCode(err);
    return Response.json({ error: code }, { status: code === "invalid_api_key" ? 401 : 502 });
  }
}

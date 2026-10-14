/** Sohbette "/" ile çağrılan hazır görevler (skill). İstemci ve sunucu ortak kullanır. */

export type SkillName = "ozet" | "sayfa" | "test";

export type SkillInfo = { name: SkillName; usage: string; description: string };

export const SKILLS: SkillInfo[] = [
  { name: "ozet", usage: "/ozet", description: "Tüm PDF'in özetini çıkarır (/ozet 10-25: yalnızca o sayfalar)" },
  { name: "sayfa", usage: "/sayfa", description: "Açık olan sayfayı özetler" },
  { name: "test", usage: "/test", description: "Tüm PDF'ten çoktan seçmeli test hazırlar (/test 10-25: yalnızca o sayfalar)" },
];

/** Yazılan komutu çözer; skill değilse null. Hatalı kullanımda hata mesajı döner. */
export function parseSkill(
  input: string,
  numPages: number,
  currentPage: number,
): { name: SkillName; from: number; to: number } | { error: string } | null {
  const m = input.trim().match(/^\/(\S+)\s*(.*)$/);
  if (!m) return null;
  const [, cmd, arg] = m;
  if (cmd === "sayfa") return { name: "sayfa", from: currentPage, to: currentPage };
  if (cmd !== "ozet" && cmd !== "test") return null;
  // Aralık verilmezse tüm belge
  if (!arg) return { name: cmd, from: 1, to: numPages };
  const r = arg.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
  if (!r) return { error: `Kullanım: /${cmd} veya /${cmd} 10-25` };
  const from = Math.max(1, +r[1]);
  const to = Math.min(numPages, r[2] ? +r[2] : from);
  if (from > to) return { error: `Geçersiz sayfa aralığı (belge ${numPages} sayfa).` };
  return { name: cmd, from, to };
}

/** İstemcinin topladığı belge metniyle birlikte sunucuya giden skill isteği. */
export type SkillRequest = {
  name: SkillName;
  from: number;
  to: number;
  fileName: string | null;
  pages: { page: number; text: string }[];
  /** Metni olmayan (taranmış, OCR yapılmamış) sayfalar */
  emptyPages: number[];
  /** Test: istenen soru sayısı (yoksa aralığa göre) */
  count?: number;
  /** Test komutsuz istendiyse kullanıcının yazdığı (konu, zorluk gibi istekler modele iletilir) */
  request?: string;
};

/**
 * Komut yazmadan istenen testi tanır: "15 soruluk test hazırla", "12-20 arası quiz",
 * "bu sayfadan test yap". Sayfa belirtilmezse tüm belge. Test isteği değilse null.
 */
export function parseQuizRequest(
  input: string,
  numPages: number,
  currentPage: number,
): { from: number; to: number; count?: number } | null {
  const text = input.toLocaleLowerCase("tr");
  const wantsQuiz =
    /(^|[^\p{L}])(test|quiz|sınav)/u.test(text) ||
    /\d+\s*(tane\s*)?soru/u.test(text);
  // "yap", "ver", "sor" yalnızca istek olarak ("test yap", "soru sor mısın"); "yapamadım", "soru" değil
  const verb =
    /(hazırla|oluştur|üret|çıkar)/u.test(text) ||
    /(^|\s)(yap|ver|sor)(ar|abilir|sana|\s*m[ıi]s[ıi]n|\s|$|[.!?,])/u.test(text);
  if (!wantsQuiz || !verb || !numPages) return null;

  const countMatch = text.match(/(\d+)\s*(tane\s*)?(soru|soruluk)/u);
  const count = countMatch ? Math.min(30, Math.max(3, +countMatch[1])) : undefined;
  const clamp = (n: number) => Math.min(numPages, Math.max(1, n));

  const range = text.match(/(\d+)\s*[-–]\s*(\d+)/u);
  if (range) {
    const from = clamp(+range[1]);
    const to = clamp(+range[2]);
    if (from <= to) return { from, to, count };
  }
  const single = text.match(/(?:s\.|sayfa)\s*(\d+)|(\d+)\.?\s*sayfa/u);
  if (single) {
    const page = clamp(+(single[1] ?? single[2]));
    return { from: page, to: page, count };
  }
  if (/(bu|şu|açık|şu\s*anki)\s*sayfa/u.test(text)) return { from: currentPage, to: currentPage, count };
  return { from: 1, to: numPages, count };
}

const SKILL_TITLES: Record<SkillName, string> = { ozet: "Özet", sayfa: "Sayfa özeti", test: "Test" };

export const skillLabel = (s: Pick<SkillRequest, "name" | "from" | "to">) =>
  `${SKILL_TITLES[s.name]} · s. ${s.from === s.to ? s.from : `${s.from}–${s.to}`}`;

/** Test için soru sayısı: tek sayfa 5, birkaç sayfa 8, daha uzun aralık 10. */
export const quizSize = (s: Pick<SkillRequest, "from" | "to" | "count">) => {
  if (s.count) return s.count;
  const pages = s.to - s.from + 1;
  return pages === 1 ? 5 : pages <= 5 ? 8 : 10;
};

/** Sayfa metinlerini sayfa numaralarıyla birleştirir. */
export const formatPages = (pages: SkillRequest["pages"]) =>
  pages.map((p) => `[s. ${p.page}]\n${p.text}`).join("\n\n");

/** Skill'in modele gidecek talimatı. */
export function skillPrompt(s: SkillRequest, body: string, partial: boolean) {
  const where = [s.fileName, s.from === s.to ? `sayfa ${s.from}` : `sayfa ${s.from}–${s.to}`]
    .filter(Boolean)
    .join(", ");
  const missing = s.emptyPages.length
    ? `\nNot: ${s.emptyPages.length} sayfada metin yok (taranmış, OCR yapılmamış); bunlar özete dahil değil.`
    : "";
  const task =
    s.name === "test"
      ? `Bu metinden ${quizSize(s)} soruluk çoktan seçmeli bir test hazırla ve createQuiz aracıyla ver.
- Sorular yalnızca metindeki bilgilere dayansın; ezberden çok anlamayı ölçsün, metnin farklı yerlerine dağılsın.
- Her sorunun 4 şıkkı olsun, yalnızca biri doğru; çeldiriciler makul ve birbirine yakın uzunlukta olsun.
- Her sorunun dayandığı sayfayı metindeki [s. N] işaretlerinden yaz.
- Yabancı dil öğreten bir metinse soruları o dilde alıştırma olarak (dilbilgisi, kelime, okuduğunu anlama), açıklamaları Türkçe yaz. Diğer metinlerde her şey Türkçe olsun.${
          s.request ? `\n- Kullanıcının isteği (konu, zorluk gibi tercihlerine uy): "${s.request.slice(0, 500)}"` : ""
        }`
      : s.name === "sayfa"
      ? "Bu sayfayı özetle: ana fikri birkaç cümleyle ver, sonra önemli noktaları madde madde sırala. Geçen önemli kişi, kavram ve terimleri kısaca açıkla."
      : `Bu metni özetle:
1. Önce 3-5 cümlelik genel bir özet ver.
2. Sonra bölüm bölüm (metinde bölüm başlıkları varsa onları kullan, yoksa konu değişimlerine göre) ana noktaları madde madde sırala; her bölümün yanına sayfa aralığını yaz.
3. Sonda öne çıkan kişileri, kavramları ve temel çıkarımları listele.`;
  const language = s.name === "test" ? "" : "\nTürkçe yaz.";
  return `${task}${language}
Metinde olmayan bir şeyi metindeymiş gibi söyleme.${missing}

<${partial ? "bolum_ozetleri" : "belge"} kaynak="${where}">
${body}
</${partial ? "bolum_ozetleri" : "belge"}>`;
}

/** Uzun belgeler parça parça özetlenir; bir parçanın yaklaşık uzunluğu (karakter). */
export const CHUNK_CHARS = 60_000;
/** Bundan uzun belgeler tek seferde gönderilmez. */
export const SINGLE_PASS_CHARS = 240_000;

export function chunkPages(pages: SkillRequest["pages"]) {
  const chunks: SkillRequest["pages"][] = [];
  let current: SkillRequest["pages"] = [];
  let size = 0;
  for (const p of pages) {
    if (size + p.text.length > CHUNK_CHARS && current.length) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

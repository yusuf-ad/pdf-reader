/** Sohbette "/" ile çağrılan hazır görevler (skill). İstemci ve sunucu ortak kullanır. */

export type SkillName = "ozet" | "sayfa" | "test" | "kelime" | "isaretle" | "kontrol";

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
  /** Test/kelime komutsuz istendiyse kullanıcının yazdığı (konu, zorluk, aranan kelimeler modele iletilir) */
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
  return { ...parseRange(text, numPages, currentPage), count };
}

/**
 * Komut yazmadan istenen toplu kelime eklemeyi tanır: "bu PDF'teki zıtlık bağlaçlarını
 * kelimelere ekle", "5. sayfadaki phrasal verb'leri kelime listeme kaydet". Değilse null.
 */
export function parseWordsRequest(
  input: string,
  numPages: number,
  currentPage: number,
): { from: number; to: number } | null {
  const text = input.toLocaleLowerCase("tr");
  if (!numPages || !/kelime/u.test(text) || !/(ekle|kaydet)/u.test(text)) return null;
  // "kelimeleri nota / metne ekle": kelime listesi değil, sayfadaki not (writeNote)
  if (/(^|\s)(not|metn|metin)/u.test(text)) return null;
  return parseRange(text, numPages, currentPage);
}

/**
 * Yanlış yapılan soruları işaretleme isteğini tanır: "3, 7 ve 12'yi yanlış yaptım işaretle",
 * "s. 40'taki yanlışlarım 2 ve 5, işaretler misin". Tek sayfa: belirtilmezse açık sayfa.
 * Soru numarası yoksa null (model hangileri olduğunu sorar).
 */
export function parseMarkRequest(
  input: string,
  numPages: number,
  currentPage: number,
): { page: number } | null {
  const text = input.toLocaleLowerCase("tr");
  if (!numPages || !/yanlış/u.test(text) || !/işaret/u.test(text)) return null;
  const pageRef = /(?:s\.|sayfa)\s*(\d+)|(\d+)\.?\s*sayfa/u;
  const single = text.match(pageRef);
  // Sayfa ve test numarası ("test 10", "10. test") çıkarıldıktan sonra soru numarası kalmalı;
  // "test 10'daki yanlışlarımı işaretle" kontrol isteğidir
  const rest = text.replace(pageRef, "").replace(/(?:test|deneme|bölüm)\s*-?\s*\d+|\d+\s*\.?\s*(?:test|deneme|bölüm)/gu, "");
  if (!/\d/.test(rest)) return null;
  const page = single ? Math.min(numPages, Math.max(1, +(single[1] ?? single[2]))) : currentPage;
  return { page };
}

/**
 * Kullanıcının sayfada işaretlediği cevapların kontrolünü tanır: "soruları check et",
 * "cevaplarımı kontrol et", "işaretlediğim şıklar doğru mu". Tek sayfa: belirtilmezse açık sayfa.
 */
export function parseCheckRequest(
  input: string,
  numPages: number,
  currentPage: number,
): { page: number } | null {
  const text = input.toLocaleLowerCase("tr");
  if (!numPages) return null;
  const about = /(soru|cevap|şık|test|işaretle)/u.test(text);
  // "hangi soruları yanlış yapmışım", "kaç doğrum var", "yanlışlarım neler" de kontrol isteğidir
  const check =
    /(kontrol|check|incele|doğru\s*mu|puanla|değerlendir|yanlışlarım|doğrularım|kaç\s*(tane\s*)?(doğru|yanlış)|yanlış\s*yap|doğru\s*yap|hangi(si|leri)?\s.*(doğru|yanlış))/u.test(
      text,
    );
  // Tek bir sorunun açıklaması istenmişse ("4. soru neden yanlış") normal soru gibi gider
  const explain = /(neden|niye|niçin|açıkla|anlat)/u.test(text);
  if (!about || !check || explain) return null;
  const single = text.match(/(?:s\.|sayfa)\s*(\d+)|(\d+)\.?\s*sayfa/u);
  const page = single ? Math.min(numPages, Math.max(1, +(single[1] ?? single[2]))) : currentPage;
  return { page };
}

/** İstekteki sayfa aralığı: "12-20", "s. 5", "bu sayfa"; belirtilmezse tüm belge. */
function parseRange(text: string, numPages: number, currentPage: number) {
  const clamp = (n: number) => Math.min(numPages, Math.max(1, n));
  const range = text.match(/(\d+)\s*[-–]\s*(\d+)/u);
  if (range) {
    const from = clamp(+range[1]);
    const to = clamp(+range[2]);
    if (from <= to) return { from, to };
  }
  const single = text.match(/(?:s\.|sayfa)\s*(\d+)|(\d+)\.?\s*sayfa/u);
  if (single) {
    const page = clamp(+(single[1] ?? single[2]));
    return { from: page, to: page };
  }
  if (/(bu|şu|açık|şu\s*anki)\s*sayfa/u.test(text)) return { from: currentPage, to: currentPage };
  return { from: 1, to: numPages };
}

const SKILL_TITLES: Record<SkillName, string> = {
  ozet: "Özet",
  sayfa: "Sayfa özeti",
  test: "Test",
  kelime: "Kelime",
  isaretle: "Yanlışları işaretle",
  kontrol: "Cevap kontrolü",
};

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
// Sayfada aynı numara birden çok testte geçebilir; istemci soruyu bunlarla ayırt eder
const SECTION_RULE =
  "section: sayfada birden fazla test/bölüm başlığı varsa sorunun altında bulunduğu başlık, sayfada yazdığı gibi (ör. \"TEST 10\"); tek bölüm varsa null. occurrence: aynı numara sayfada birden fazla soruda geçiyorsa bu soru okuma sırasına göre kaçıncısı (1 = ilk; iki sütunda önce sol sütun yukarıdan aşağı); tek geçiyorsa null.";

export function skillPrompt(s: SkillRequest, body: string, partial: boolean) {
  const where = [s.fileName, s.from === s.to ? `sayfa ${s.from}` : `sayfa ${s.from}–${s.to}`]
    .filter(Boolean)
    .join(", ");
  const missing = s.emptyPages.length
    ? `\nNot: ${s.emptyPages.length} sayfada metin yok (taranmış, OCR yapılmamış); bunlar ${s.name === "kelime" ? "aramaya" : "özete"} dahil değil.`
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
      : s.name === "kelime"
      ? `Kullanıcının isteğine uyan kelime/ifadeleri bu metinde bul ve proposeWords aracıyla kelime listesine eklenmek üzere öner.
- Kullanıcının isteği: "${(s.request ?? "").slice(0, 500)}"
- Yalnızca metinde gerçekten geçenleri al. Geçtiği cümleyi metinden aynen kopyala, sayfasını metindeki [s. N] işaretlerinden yaz.
- Aynı kelime birden çok yerde geçiyorsa bir kez al, anlamını en iyi gösteren cümleyle.
- Türkçe karşılığı bu bağlamdaki anlamı olsun. Kullanıcı eş anlamlı isterse her kelimenin yaygın eş anlamlılarını synonyms alanına yaz (genel bilgin; metinde geçmesi gerekmez), istemezse boş bırak.
- İsteğe uyan bir şey bulamazsan aracı çağırma, bunu kısaca söyle.`
      : s.name === "isaretle"
      ? `Kullanıcı bu sayfadaki bazı soruları yanlış yaptı ve sayfada işaretlenmesini istiyor. Söylediği soruları metinden çöz ve markQuestions aracıyla ver.
- Kullanıcının isteği: "${(s.request ?? "").slice(0, 500)}"
- Yalnızca kullanıcının söylediği numaraları al. Metinde bulamadığın numarayı atla.
- Her soruyu dikkatle çöz. Sayfada cevap anahtarı varsa onu esas al.
- Sayfada birden fazla test/bölüm varsa (ör. TEST 9'un sonu ve TEST 10) ve kullanıcı birini söylediyse ("test 10") numaraları o testte ara.
- checked ve chosen: null. number: soru numarası, metinde yazdığı gibi (ör. "12"). ${SECTION_RULE} correct: doğru şıkkın harfi (ör. "C"). correctText: o şıkkın metni, metinden aynen kopyalanmış.
- note: sayfaya yazılacak kısa Türkçe not, en fazla 2 kısa cümle: neden o şık doğru, varsa tuzak neydi. Şıkkı tekrar yazma, "Doğru: C" gibi bir başlangıç da ekleme (o ayrıca yazılır).`
      : s.name === "kontrol"
      ? `Kullanıcı bu sayfadaki soruları çözdü ve seçtiği şıkları sayfada işaretledi. Cevaplarını kontrol et ve yanlış yaptıklarını markQuestions aracıyla ver.
- Kullanıcının isteği: "${(s.request ?? "").slice(0, 500)}"
- Ekteki görsel, kullanıcının işaretleriyle birlikte sayfanın kendisidir. Her soruda kullanıcının hangi şıkkı seçtiğini görselden oku: daire içine alma, tik, çarpı, altını çizme, fosforlu kalem ya da vurgu olabilir. Sayfa metni (aşağıda) yazıyı doğru okuman için.
- Sayfada birden fazla test/bölüm varsa (ör. TEST 9'un sonu ve TEST 10) ve kullanıcı birini söylediyse ("test 10'u kontrol et") YALNIZCA o testin sorularını kontrol et; diğerlerini checked'a da sayma.
- Hiçbir şıkkı işaretlenmemiş soruyu atla. Bir soruda seçim belirsizse (iki şık işaretli gibi) en belirgin olanı al.
- Doğru cevabı bul: sayfada ya da metinde cevap anahtarı varsa onu esas al, yoksa soruyu dikkatle kendin çöz.
- checked: şık işaretlenmiş soru sayısı. questions: YALNIZCA kullanıcının yanlış yaptığı sorular; hepsi doğruysa boş liste.
- number: soru numarası, metinde yazdığı gibi. ${SECTION_RULE} chosen: kullanıcının seçtiği şıkkın harfi. correct: doğru şıkkın harfi. correctText: doğru şıkkın metni, metinden aynen kopyalanmış.
- note: sayfaya yazılacak kısa Türkçe not, en fazla 2 kısa cümle: neden doğru şık doğru, kullanıcının seçtiği neden yanlış. "Doğru: C" gibi bir başlangıç ekleme (o ayrıca yazılır).
- Görselde hiçbir işaretli şık göremiyorsan checked 0, questions boş olsun.`
      : s.name === "sayfa"
      ? "Bu sayfayı özetle: ana fikri birkaç cümleyle ver, sonra önemli noktaları madde madde sırala. Geçen önemli kişi, kavram ve terimleri kısaca açıkla."
      : `Bu metni özetle:
1. Önce 3-5 cümlelik genel bir özet ver.
2. Sonra bölüm bölüm (metinde bölüm başlıkları varsa onları kullan, yoksa konu değişimlerine göre) ana noktaları madde madde sırala; her bölümün yanına sayfa aralığını yaz.
3. Sonda öne çıkan kişileri, kavramları ve temel çıkarımları listele.`;
  const language = s.name === "ozet" || s.name === "sayfa" ? "\nTürkçe yaz." : "";
  // Uzun belgede parçalardan önce özet (kelime aramasında bulunanlar) çıkarılır
  const tag = partial ? (s.name === "kelime" ? "parca_bulgulari" : "bolum_ozetleri") : "belge";
  return `${task}${language}
Metinde olmayan bir şeyi metindeymiş gibi söyleme.${missing}

<${tag} kaynak="${where}">
${body}
</${tag}>`;
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

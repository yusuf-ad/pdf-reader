/** Sohbette "/" ile çağrılan hazır görevler (skill). İstemci ve sunucu ortak kullanır. */

export type SkillName = "ozet" | "sayfa";

export type SkillInfo = { name: SkillName; usage: string; description: string };

export const SKILLS: SkillInfo[] = [
  { name: "ozet", usage: "/ozet", description: "Tüm PDF'in özetini çıkarır (/ozet 10-25: yalnızca o sayfalar)" },
  { name: "sayfa", usage: "/sayfa", description: "Açık olan sayfayı özetler" },
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
  if (cmd !== "ozet") return null;
  if (!arg) return { name: "ozet", from: 1, to: numPages };
  const r = arg.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
  if (!r) return { error: "Kullanım: /ozet veya /ozet 10-25" };
  const from = Math.max(1, +r[1]);
  const to = Math.min(numPages, r[2] ? +r[2] : from);
  if (from > to) return { error: `Geçersiz sayfa aralığı (belge ${numPages} sayfa).` };
  return { name: "ozet", from, to };
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
};

export const skillLabel = (s: Pick<SkillRequest, "name" | "from" | "to">) =>
  s.from === s.to ? `${s.name === "sayfa" ? "Sayfa özeti" : "Özet"} · s. ${s.from}` : `Özet · s. ${s.from}–${s.to}`;

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
    s.name === "sayfa"
      ? "Bu sayfayı özetle: ana fikri birkaç cümleyle ver, sonra önemli noktaları madde madde sırala. Geçen önemli kişi, kavram ve terimleri kısaca açıkla."
      : `Bu metni özetle:
1. Önce 3-5 cümlelik genel bir özet ver.
2. Sonra bölüm bölüm (metinde bölüm başlıkları varsa onları kullan, yoksa konu değişimlerine göre) ana noktaları madde madde sırala; her bölümün yanına sayfa aralığını yaz.
3. Sonda öne çıkan kişileri, kavramları ve temel çıkarımları listele.`;
  return `${task}
Türkçe yaz. Metinde olmayan bir şeyi metindeymiş gibi söyleme.${missing}

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

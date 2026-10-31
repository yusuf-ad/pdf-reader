// Bazı PDF'lerde fontun karakter eşlemesi (ToUnicode) bozuk: "i" harfi metin katmanına
// "Ĝ" ya da "Ğ" olarak çıkar ("volatĜlĜty", "ĜnĜtĜally"). Ĝ Türkçe/İngilizcede hiç geçmez;
// büyük Ğ ise hiçbir kelimede küçük harfe bitişik olamaz. Uzunluk değişmez, konumlar korunur.
const BROKEN_I = /Ĝ|(?<=\p{Ll})Ğ|Ğ(?=\p{Ll})/gu;

export const repairPdfText = (s: string) => s.replace(BROKEN_I, "i");

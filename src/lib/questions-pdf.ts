import { translate } from "./i18n";
// Klasördeki soruları alt alta dizip tek bir PDF yapar (tekrar çözmek için).
// Her soru tek parça kalır: sayfaya sığmazsa sonraki sayfaya geçer.
import fontkit from "@cantoo/fontkit";
import { PDFDocument, rgb, type PDFImage } from "@cantoo/pdf-lib";
import type { Question } from "./questions";

// Türkçe harfler için gömülü font (export-pdf ile aynı)
const FONT_URL = "/pdfjs/standard_fonts/LiberationSans-Regular.ttf";
const PAGE_W = 595.28; // A4, pt
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LABEL_SIZE = 9;
const LABEL_GAP = 6;
const QUESTION_GAP = 28;
// Yapıştırılan ekran görüntüleri: piksel başına bu kadar pt (küçük görüntü dev görünmesin)
const PX_TO_PT = 0.6;
const MUTED = rgb(0.45, 0.43, 0.4);

/** pdf-lib yalnızca PNG ve JPEG gömer; diğerleri (webp, gif…) PNG'ye çevrilir. */
async function embed(doc: PDFDocument, blob: Blob): Promise<PDFImage> {
  const bytes = await blob.arrayBuffer();
  if (blob.type === "image/png") return doc.embedPng(bytes);
  if (blob.type === "image/jpeg") return doc.embedJpg(bytes);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(translate("ai", "questionsImageConvertError")))), "image/png"),
  );
  return doc.embedPng(await png.arrayBuffer());
}

export async function questionsToPdf(title: string, questions: Question[]): Promise<File> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  const font = await doc.embedFont(await (await fetch(FONT_URL)).arrayBuffer(), { subset: true });

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN; // PDF'te y yukarı doğru artar; y imlecin üst kenarı

  // İlk sayfanın başında klasör adı
  const TITLE_SIZE = 16;
  page.drawText(title, { x: MARGIN, y: y - TITLE_SIZE, size: TITLE_SIZE, font });
  y -= TITLE_SIZE + QUESTION_GAP;

  for (const [i, q] of questions.entries()) {
    const image = await embed(doc, q.image);
    // Genişliğe sığdır; sayfadan uzun soru da tek sayfaya sığacak kadar küçülür
    const labelH = LABEL_SIZE + LABEL_GAP;
    // Kırpılan soru kaynak sayfadaki boyutunda basılır (görüntü netlik için büyük çizildi)
    const natural = q.sourceWidth ? q.sourceWidth / image.width : PX_TO_PT;
    const scale = Math.min(
      natural,
      CONTENT_W / image.width,
      (PAGE_H - MARGIN * 2 - labelH) / image.height,
    );
    const w = image.width * scale;
    const h = image.height * scale;

    if (y - labelH - h < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }

    const source = [q.bookName?.replace(/\.pdf$/i, ""), q.page && translate("ai", "pageReference", { page: q.page })].filter(Boolean).join(", ");
    const label = translate("ai", "questionsPdfQuestion", { n: i + 1, source: source ? `  ·  ${source}` : "" });
    page.drawText(label, { x: MARGIN, y: y - LABEL_SIZE, size: LABEL_SIZE, font, color: MUTED });
    y -= labelH;
    page.drawImage(image, { x: MARGIN, y: y - h, width: w, height: h });
    y -= h + QUESTION_GAP;
  }

  // Sayfa numaraları
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const text = `${i + 1} / ${pages.length}`;
    const tw = font.widthOfTextAtSize(text, LABEL_SIZE);
    p.drawText(text, { x: (PAGE_W - tw) / 2, y: MARGIN / 2, size: LABEL_SIZE, font, color: MUTED });
  });

  const bytes = await doc.save();
  const name = translate("ai", "questionsPdfFilename", { title: title.replace(/[\\/:*?"<>|]+/g, "-") });
  return new File([bytes as BlobPart], name, { type: "application/pdf", lastModified: Date.now() });
}

import { translate } from "./i18n";
// Boş defter: kendi notlarını almak için boş/çizgili/kareli sayfalardan oluşan bir PDF.
// Kitaplığa sıradan bir PDF gibi girer; kalem, yazı ve vurgu araçları üzerinde aynen çalışır.
// Açık kitaba (defter ya da sıradan PDF) araya aynı türden boş sayfa da eklenebilir.
import { PDFDocument, rgb, type PDFPage } from "@cantoo/pdf-lib";
import { loadPdf } from "./export-pdf";

export type PaperStyle = "blank" | "lined" | "grid";

const PAGE_W = 595.28; // A4, pt
const PAGE_H = 841.89;
const MARGIN = 48;
const LINE_GAP = 26;
const GRID_GAP = 17;
const RULE = rgb(0.82, 0.8, 0.76);

function drawPaper(page: PDFPage, style: PaperStyle) {
  const { width, height } = page.getSize();
  if (style === "lined") {
    for (let y = height - MARGIN - LINE_GAP; y > MARGIN; y -= LINE_GAP) {
      page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 0.5, color: RULE });
    }
  } else if (style === "grid") {
    for (let x = MARGIN; x <= width - MARGIN; x += GRID_GAP) {
      page.drawLine({ start: { x, y: MARGIN }, end: { x, y: height - MARGIN }, thickness: 0.35, color: RULE });
    }
    for (let y = MARGIN; y <= height - MARGIN; y += GRID_GAP) {
      page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 0.35, color: RULE });
    }
  }
}

export async function blankBookPdf(title: string, pages: number, style: PaperStyle): Promise<File> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  // Kitap anahtarı içerikten üretilir: aynı ad ve sayfa sayısıyla açılan iki defter
  // birbirine karışmasın diye oluşturma zamanı da içerikte durur
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  for (let i = 0; i < pages; i++) drawPaper(doc.addPage([PAGE_W, PAGE_H]), style);

  const bytes = await doc.save();
  const name = `${title.replace(/[\/:*?"<>|]+/g, " ").trim() || translate("library", "blankDefaultName")}.pdf`;
  return new File([bytes as BlobPart], name, { type: "application/pdf", lastModified: now.getTime() });
}

/**
 * `after`. sayfanın (1'den başlar) arkasına boş sayfa ekler. Yeni sayfa o sayfayla aynı
 * boyuttadır (yan yana dönmüş sayfalarda da). Dosya adı aynı kalır.
 */
export async function insertBlankPage(file: File, after: number, style: PaperStyle): Promise<File> {
  const doc = await loadPdf(await file.arrayBuffer());
  const ref = doc.getPage(Math.min(after, doc.getPageCount()) - 1);
  const { width, height } = ref.getSize();
  // Döndürülmüş sayfa ekranda yan döner; yeni sayfa ekranda göründüğü gibi olsun
  const turned = ref.getRotation().angle % 180 !== 0;
  const page = doc.insertPage(after, turned ? [height, width] : [width, height]);
  drawPaper(page, style);
  const now = new Date();
  doc.setModificationDate(now);
  const bytes = await doc.save();
  return new File([bytes as BlobPart], file.name, { type: "application/pdf", lastModified: now.getTime() });
}

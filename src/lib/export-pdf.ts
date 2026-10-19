// Notları (kalem, yazı, vurgu) PDF'in içine yazar ve kaydeder. Kitaplıktaki kopya ve
// uygulamadaki notlar olduğu gibi kalır; çıktı ayrı bir dosyadır.
import fontkit from "@cantoo/fontkit";
import {
  appendBezierCurve,
  BlendMode,
  concatTransformationMatrix,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  PDFDict,
  PDFDocument,
  PDFInvalidObject,
  PDFName,
  PDFRef,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  stroke,
  type PDFFont,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { strokePath, type Annotation, type Note, type Stroke } from "./annotations";

// Türkçe harfler için gömülü font (pdf.js'in standart fontlarından, public/pdfjs altına kopyalanır)
const FONT_URL = "/pdfjs/standard_fonts/LiberationSans-Regular.ttf";
// annotation-layer ve highlight-layer ile aynı görünüm
const LINE_HEIGHT = 1.3;
const HIGHLIGHT_OPACITY = 0.35;

function color(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/**
 * Ekranda görünen sayfanın koordinatlarını (sol üst köşe, aşağı doğru artan, pt) PDF
 * koordinatlarına çeviren matris. Sayfa döndürmesi ve kırpma kutusu hesaba katılır.
 */
function displayMatrix(page: PDFPage) {
  const { x, y, width: W, height: H } = page.getCropBox();
  const rotation = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const m = {
    0: [1, 0, 0, -1, x, y + H],
    90: [0, 1, 1, 0, x, y],
    180: [-1, 0, 0, 1, x + W, y],
    270: [0, -1, -1, 0, x + W, y + H],
  }[rotation] ?? [1, 0, 0, -1, x, y + H];
  const sideways = rotation === 90 || rotation === 270;
  return { m, w: sideways ? H : W, h: sideways ? W : H };
}

/** Ekrandaki strokePath ile aynı eğri: orta noktalardan geçen ikinci derece eğriler. */
function drawStroke(page: PDFPage, s: Stroke, w: number, h: number) {
  const pts = s.points;
  const n = pts.length / 2;
  if (!n) return;
  const px = (i: number) => pts[i * 2] * w;
  const py = (i: number) => pts[i * 2 + 1] * h;
  const ops = [
    setStrokingColor(color(s.color)),
    setLineWidth(s.width * w),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
    moveTo(px(0), py(0)),
  ];
  let cx = px(0);
  let cy = py(0);
  // İkinci derece eğriyi PDF'in desteklediği üçüncü dereceye çevirir
  const quad = (qx: number, qy: number, ex: number, ey: number) => {
    ops.push(
      appendBezierCurve(
        cx + (2 / 3) * (qx - cx),
        cy + (2 / 3) * (qy - cy),
        ex + (2 / 3) * (qx - ex),
        ey + (2 / 3) * (qy - ey),
        ex,
        ey,
      ),
    );
    cx = ex;
    cy = ey;
  };
  if (n === 1) ops.push(lineTo(cx + 0.01, cy));
  for (let i = 1; i < n - 1; i++) quad(px(i), py(i), (px(i) + px(i + 1)) / 2, (py(i) + py(i + 1)) / 2);
  if (n > 1) ops.push(lineTo(px(n - 1), py(n - 1)));
  ops.push(stroke());
  page.pushOperators(...ops);
}

/** Metni verilen genişliğe sığacak satırlara böler (ekrandaki break-words gibi). */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (!line || width(line + word.trimEnd()) <= maxWidth) {
        line += word;
        continue;
      }
      lines.push(line.trimEnd());
      line = word;
    }
    // Tek başına sığmayan uzun kelimeler harf harf bölünür
    while (line.length > 1 && width(line.trimEnd()) > maxWidth) {
      let cut = line.length - 1;
      while (cut > 1 && width(line.slice(0, cut)) > maxWidth) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function drawNote(page: PDFPage, note: Note, font: PDFFont, w: number, h: number, m: number[]) {
  const size = note.size * w;
  // Ekrandaki maxWidth: max(80px, kalan genişlik − 8px); px ile pt aynı orana sahip
  const maxWidth = note.width
    ? note.width * w
    : Math.max((80 / 820) * w, (1 - note.x) * w - (8 / 820) * w);
  const ascent = font.heightAtSize(size, { descender: false });
  const lines = wrap(note.text, font, size, maxWidth);
  lines.forEach((line, i) => {
    if (!line) return;
    // Satır yüksekliğinin ortasına yerleşen yazının taban çizgisi
    const baseline = note.y * h + i * size * LINE_HEIGHT + (size * (LINE_HEIGHT - 1)) / 2 + ascent;
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]),
      // Ekran koordinatları aşağı doğru artar; yazı ters çıkmasın
      concatTransformationMatrix(1, 0, 0, -1, note.x * w, baseline),
    );
    page.drawText(line, { x: 0, y: 0, size, font, color: color(note.color) });
    page.pushOperators(popGraphicsState());
  });
}

/**
 * PDF'i düzenlenebilir olarak açar. Kopyalama/yazdırma kısıtı olan PDF'ler (ör. ÖSYM) boş
 * açılış parolasıyla şifrelenmiştir; boş parolayla çözülür, kayıt şifresiz olur. Şifre
 * çözülmeden okunursa nesneler bozuk çıkar ("Expected instance of PDFDict…").
 */
async function loadPdf(bytes: ArrayBuffer) {
  try {
    const doc = await PDFDocument.load(bytes, { password: "", warnOnInvalidObjects: false });
    dropEncryptionLeftovers(doc);
    return doc;
  } catch (err) {
    if (/password/i.test((err as Error).message)) {
      throw new Error("Bu PDF açılış parolasıyla korunuyor; notlu kopyası kaydedilemiyor.");
    }
    throw err;
  }
}

/**
 * Şifresi çözülen PDF'in eski xref akışları ve şifre sözlüğü kayda taşınmasın; yoksa kaydedilen
 * dosya hâlâ şifreli sanılır ve bir sonraki kayıtta açılamaz. Okunamayan (ham kopyalanan)
 * nesnelerden yalnızca bunlara ait olanlar atılır.
 */
function dropEncryptionLeftovers(doc: PDFDocument) {
  const { context } = doc;
  const latin1 = new TextDecoder("latin1");
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : (obj as { dict?: unknown }).dict;
    const type = dict instanceof PDFDict ? dict.get(PDFName.of("Type")) : undefined;
    const stale =
      obj instanceof PDFInvalidObject && /\/(XRef|Encrypt)/.test(latin1.decode((obj as unknown as { data: Uint8Array }).data));
    if (stale || type === PDFName.of("XRef") || type === PDFName.of("ObjStm")) context.delete(ref);
  }
  const encrypt = context.trailerInfo.Encrypt;
  if (encrypt instanceof PDFRef) context.delete(encrypt);
  context.trailerInfo.Encrypt = undefined;
}

/** Notları PDF'e yazılmış yeni bir PDF üretir. */
export async function exportAnnotatedPdf(file: File, annotations: Record<number, Annotation[]>) {
  const doc = await loadPdf(await file.arrayBuffer());
  doc.registerFontkit(fontkit);
  const needsFont = Object.values(annotations).some((items) => items.some((a) => a.type === "text"));
  const font = needsFont
    ? await doc.embedFont(await (await fetch(FONT_URL)).arrayBuffer(), { subset: true })
    : null;

  const pages = doc.getPages();
  for (const [num, items] of Object.entries(annotations)) {
    const page = pages[Number(num) - 1];
    if (!page || !items.length) continue;
    const { m, w, h } = displayMatrix(page);

    // Önce vurgular (metnin altında kalsın), sonra çizgiler, en üstte yazılar
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]));
    for (const a of items) {
      if (a.type !== "highlight") continue;
      for (let i = 0; i < a.rects.length; i += 4) {
        page.drawRectangle({
          x: a.rects[i] * w,
          y: a.rects[i + 1] * h,
          width: a.rects[i + 2] * w,
          height: a.rects[i + 3] * h,
          color: color(a.color),
          opacity: HIGHLIGHT_OPACITY,
          blendMode: BlendMode.Multiply,
        });
      }
    }
    // Fosforlu kalem: vurgular gibi yarı saydam. drawSvgPath y eksenini kendisi ters çevirdiği
    // için burada bir kez daha çevrilir.
    for (const a of items) {
      if (a.type !== "ink" || !a.marker) continue;
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, 0, 0));
      page.drawSvgPath(strokePath(a.points, w, h), {
        x: 0,
        y: 0,
        borderColor: color(a.color),
        borderWidth: a.width * w,
        borderOpacity: HIGHLIGHT_OPACITY,
        borderLineCap: LineCapStyle.Round,
        blendMode: BlendMode.Multiply,
      });
      page.pushOperators(popGraphicsState());
    }
    for (const a of items) if (a.type === "ink" && !a.marker) drawStroke(page, a, w, h);
    page.pushOperators(popGraphicsState());

    if (font) for (const a of items) if (a.type === "text") drawNote(page, a, font, w, h, m);
  }
  return doc.save();
}

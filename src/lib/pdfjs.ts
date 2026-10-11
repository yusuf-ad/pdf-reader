"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjs } from "react-pdf";

// react-pdf yüklendikten sonra çalıştığı için varsayılan worker ayarını ezer
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// Dosyalar scripts/copy-pdfjs-assets.mjs ile public/pdfjs altına kopyalanır.
// wasmUrl olmadan taranmış (JBIG2) PDF'lerin sayfa görüntüleri boş çıkar.
export const PDF_OPTIONS = {
  wasmUrl: "/pdfjs/wasm/",
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  iccUrl: "/pdfjs/iccs/",
  // Yalnızca hatalar: taranmış PDF'lerde "Dependent image isn't ready yet" gibi
  // zararsız uyarılar konsolu/terminali doldurmasın (pdfjs VerbosityLevel.ERRORS)
  verbosity: 0,
};

const COVER_WIDTH = 320; // kartta ~160px, yüksek çözünürlüklü ekranlar için 2 katı

/** İlk sayfayı küçük bir JPEG'e çizer (kitaplık kapağı). */
export async function renderCover(doc: PDFDocumentProxy): Promise<string> {
  const page = await doc.getPage(1);
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: COVER_WIDTH / natural.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Açılmamış bir dosya için kapak ve sayfa sayısı. */
export async function describePdf(file: File) {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...PDF_OPTIONS });
  const doc = await task.promise;
  try {
    return { numPages: doc.numPages, cover: await renderCover(doc) };
  } finally {
    await task.destroy();
  }
}

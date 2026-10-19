"use client";

import type { FileUIPart } from "ai";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getBookAnnotations, strokePath } from "./annotations";

// Sayfanın, kullanıcının işaretleri (kalem, fosforlu kalem, vurgu, yazı) çizilmiş görüntüsü.
// Kalemle daire içine alınan, tiklenen şıklar metin olarak bilinemez; model bunları görselden okur.

// Görsel bu genişlikte (yazı ve el işaretleri okunsun, istek büyümesin)
const IMAGE_WIDTH = 1600;
// Ekrandaki saydamlıklar (highlight-layer)
const HIGHLIGHT_ALPHA = 0.35;

export async function renderMarkedPage(
  pdf: PDFDocumentProxy,
  book: string,
  pageNumber: number,
): Promise<FileUIPart> {
  const page = await pdf.getPage(pageNumber);
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: IMAGE_WIDTH / natural.width });
  const canvas = document.createElement("canvas");
  const w = (canvas.width = Math.round(viewport.width));
  const h = (canvas.height = Math.round(viewport.height));
  await page.render({ canvas, viewport }).promise;

  const ctx = canvas.getContext("2d")!;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const a of getBookAnnotations(book)[pageNumber] ?? []) {
    ctx.save();
    if (a.type === "highlight") {
      ctx.globalAlpha = HIGHLIGHT_ALPHA;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = a.color;
      for (let i = 0; i < a.rects.length; i += 4) {
        ctx.fillRect(a.rects[i] * w, a.rects[i + 1] * h, a.rects[i + 2] * w, a.rects[i + 3] * h);
      }
    } else if (a.type === "ink") {
      if (a.marker) {
        ctx.globalAlpha = HIGHLIGHT_ALPHA;
        ctx.globalCompositeOperation = "multiply";
      }
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(1.5, a.width * w);
      ctx.stroke(new Path2D(strokePath(a.points, w, h)));
    } else {
      ctx.fillStyle = a.color;
      const size = a.size * w;
      ctx.font = `${size}px sans-serif`;
      a.text.split("\n").forEach((line, i) => ctx.fillText(line, a.x * w, a.y * h + size * (1 + i * 1.3)));
    }
    ctx.restore();
  }

  const url = canvas.toDataURL("image/jpeg", 0.85);
  canvas.width = canvas.height = 0; // belleği hemen bırak
  return { type: "file", mediaType: "image/jpeg", filename: `sayfa-${pageNumber}.jpg`, url };
}

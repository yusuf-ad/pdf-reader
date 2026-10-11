"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { Document, Page, type PageProps } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { Tool } from "@/lib/annotations";
import { PDF_OPTIONS } from "@/lib/pdfjs"; // worker ayarını da yapar
import AnnotationLayer from "./annotation-layer";

type Props = {
  file: File;
  pageWidth: number;
  pageHeight: number;
  textRenderer?: PageProps["customTextRenderer"];
  onLoad: (pdf: PDFDocumentProxy) => void;
  /** Notların kaydedileceği kitap anahtarı */
  bookKey: string;
  tool: Tool | null;
  color: string;
};

type AnnotationProps = Pick<Props, "bookKey" | "tool" | "color">;

export default function PdfViewer({ file, pageWidth, pageHeight, textRenderer, onLoad, ...annotation }: Props) {
  const [numPages, setNumPages] = useState(0);

  return (
    // suspense={false}: react-pdf v11 varsayılan olarak Suspense kullanıyor; bu da
    // next/dynamic sınırının görüntüleyiciyi display:none ile gizlemesine yol açıyordu.
    <Document
      suspense={false}
      file={file}
      options={PDF_OPTIONS}
      onLoadSuccess={(pdf) => {
        setNumPages(pdf.numPages);
        onLoad(pdf);
      }}
      loading={<p className="py-16 text-center text-sm text-muted">Açılıyor…</p>}
      error={<p className="py-16 text-center text-sm text-accent">Bu PDF açılamadı.</p>}
      // w-fit + mx-auto: yakınlaştırınca sayfa taşarsa sol kenar kesilmesin, yatay kaydırılabilsin
      className="flex w-fit min-w-full flex-col gap-10"
    >
      {pageWidth > 0 &&
        Array.from({ length: numPages }, (_, i) => (
          <LazyPage
            key={i}
            pageNumber={i + 1}
            width={pageWidth}
            height={pageHeight}
            textRenderer={textRenderer}
            annotation={annotation}
          />
        ))}
    </Document>
  );
}

// Yakınlaştırma bittikten bu kadar sonra sayfa yeni çözünürlükte yeniden çizilir
const RERENDER_DELAY = 200;

/**
 * Sayfayı yalnızca ekrana yaklaştığında çizer; uzun kitaplarda yüzlerce canvas oluşmasın.
 *
 * Yakınlaştırırken sayfa kaybolmasın diye: react-pdf genişlik değişince canvas'ı hemen
 * temizleyip yeniden çiziyor (arada boş sayfa görünüyor). Bunun yerine mevcut çizim CSS ile
 * anında ölçeklenir, yeni çözünürlük görünmez bir katmanda çizilir ve hazır olunca yer değiştirir.
 */
function LazyPage({
  pageNumber,
  width,
  height,
  textRenderer,
  annotation,
}: {
  pageNumber: number;
  width: number;
  height: number;
  textRenderer?: PageProps["customTextRenderer"];
  annotation: AnnotationProps;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  // Sayfanın kendi en/boy oranı (sayfalar arasında küçük farklar olabiliyor)
  const [aspect, setAspect] = useState<number | null>(null);
  // Çizilecek genişlik: yakınlaştırma durunca güncellenir
  const [target, setTarget] = useState(width);
  // Ekranda gösterilen, çizimi tamamlanmış genişlik
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      // Önceden yükleme payı ancak kaydırma kutusu root olursa işe yarar
      { root: el.closest("[data-scroll-root]"), rootMargin: "1500px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (width === target) return;
    const timer = setTimeout(() => setTarget(width), RERENDER_DELAY);
    return () => clearTimeout(timer);
  }, [width, target]);

  // Aynı anda en fazla iki katman: gösterilen ve arkada hazırlanan.
  // Tek bir anahtarlı liste olduğu için hazırlanan katman öne geçerken yeniden oluşturulmaz.
  const layers = shown === null || shown === target ? [target] : [shown, target];
  const frameHeight = aspect ? width * aspect : height;

  return (
    <figure ref={ref} data-page-number={pageNumber} className="mx-auto">
      <div
        style={{ width, height: frameHeight }}
        className="page-frame relative overflow-hidden"
      >
        {visible &&
          layers.map((w) => {
            const pending = w !== shown && shown !== null;
            return (
              <div
                key={w}
                aria-hidden={pending || undefined}
                style={{ width: w, transform: `scale(${width / w})` }}
                className={`absolute top-0 left-0 origin-top-left ${pending ? "invisible" : ""}`}
              >
                <Page
                  suspense={false}
                  pageNumber={pageNumber}
                  width={w}
                  loading={null}
                  customTextRenderer={textRenderer}
                  onLoadSuccess={(page) => setAspect(page.originalHeight / page.originalWidth)}
                  onRenderSuccess={() => setShown(w)}
                  renderAnnotationLayer
                  renderTextLayer
                />
              </div>
            );
          })}
        {visible && (
          <AnnotationLayer
            book={annotation.bookKey}
            page={pageNumber}
            width={width}
            height={frameHeight}
            tool={annotation.tool}
            color={annotation.color}
          />
        )}
      </div>
      <figcaption className="mt-2 text-center text-xs tabular-nums text-muted">
        {pageNumber}
      </figcaption>
    </figure>
  );
}

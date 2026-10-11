"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { Document, Page, type PageProps, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// Dosyalar scripts/copy-pdfjs-assets.mjs ile public/pdfjs altına kopyalanır.
// wasmUrl olmadan taranmış (JBIG2) PDF'lerin sayfa görüntüleri boş çıkar.
const PDF_OPTIONS = {
  wasmUrl: "/pdfjs/wasm/",
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  iccUrl: "/pdfjs/iccs/",
};

type Props = {
  file: File;
  pageWidth: number;
  pageHeight: number;
  textRenderer?: PageProps["customTextRenderer"];
  onLoad: (pdf: PDFDocumentProxy) => void;
};

export default function PdfViewer({ file, pageWidth, pageHeight, textRenderer, onLoad }: Props) {
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
          />
        ))}
    </Document>
  );
}

/** Sayfayı yalnızca ekrana yaklaştığında çizer; uzun kitaplarda yüzlerce canvas oluşmasın. */
function LazyPage({
  pageNumber,
  width,
  height,
  textRenderer,
}: {
  pageNumber: number;
  width: number;
  height: number;
  textRenderer?: PageProps["customTextRenderer"];
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

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

  return (
    <figure ref={ref} data-page-number={pageNumber} className="mx-auto">
      <div style={{ minHeight: height, width }}>
        {visible && (
          <Page
            suspense={false}
            pageNumber={pageNumber}
            width={width}
            loading={null}
            customTextRenderer={textRenderer}
            renderAnnotationLayer
            renderTextLayer
          />
        )}
      </div>
      <figcaption className="mt-2 text-center text-xs tabular-nums text-muted">
        {pageNumber}
      </figcaption>
    </figure>
  );
}

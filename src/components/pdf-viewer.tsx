"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { Document, Page, type PageProps } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { Tool } from "@/lib/annotations";
import { useOcr } from "@/lib/ocr";
import { PDF_OPTIONS } from "@/lib/pdfjs"; // worker ayarını da yapar
import { AiCursor } from "./ai-marker";
import AnnotationLayer from "./annotation-layer";
import CropLayer, { type CropPart } from "./crop-layer";
import HighlightLayer from "./highlight-layer";
import OcrTextLayer from "./ocr-text-layer";

type Props = {
  file: File;
  pageWidth: number;
  pageHeight: number;
  textRenderer?: PageProps["customTextRenderer"];
  onLoad: (pdf: PDFDocumentProxy) => void;
  /** PDF içindeki bağlantılar (ör. kitabın kendi içindekiler sayfası) */
  onGoTo: (page: number) => void;
  /** Notların kaydedileceği kitap anahtarı */
  bookKey: string;
  tool: Tool | null;
  color: string;
  /** Taranmış sayfalarda metin tanıma açık mı */
  ocr: boolean;
  /** Vurgulanan metni sohbete sor */
  onAskHighlight: (text: string, page: number) => void;
  /** Soru kırpma açıkken verilir */
  onCrop?: (parts: CropPart[]) => void;
};

type PageExtras = Pick<Props, "bookKey" | "tool" | "color" | "ocr" | "onAskHighlight" | "onCrop">;

export default function PdfViewer({ file, pageWidth, pageHeight, textRenderer, onLoad, onGoTo, ...annotation }: Props) {
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
      // Sayfalar ekrana yaklaşınca çizildiği için react-pdf hedef sayfayı kendi bulamıyor
      onItemClick={({ pageNumber }) => onGoTo(pageNumber)}
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
// Sayfa ekrana bu kadar yaklaşınca çizilir, bu kadar uzaklaşınca atılır (arada gidip gelince
// her seferinde yeniden çizilmesin)
const MOUNT_MARGIN = "1500px 0px";
const UNMOUNT_MARGIN = "4000px 0px";

// Ekrandan çıkan sayfaların küçük görüntüsü: geri gelince yeni çizim hazır olana kadar
// beyaz sayfa yerine bu görünür (taranmış sayfaların çizimi saniyeler sürebiliyor)
const SNAPSHOT_WIDTH = 480;
const SNAPSHOT_LIMIT = 80;
const snapshots = new Map<string, string>();

function saveSnapshot(key: string, canvas: HTMLCanvasElement) {
  if (!canvas.width || !canvas.height) return;
  const small = document.createElement("canvas");
  small.width = Math.min(SNAPSHOT_WIDTH, canvas.width);
  small.height = Math.round((canvas.height * small.width) / canvas.width);
  small.getContext("2d")?.drawImage(canvas, 0, 0, small.width, small.height);
  small.toBlob(
    (blob) => {
      if (!blob) return;
      const old = snapshots.get(key);
      if (old) URL.revokeObjectURL(old);
      snapshots.delete(key);
      snapshots.set(key, URL.createObjectURL(blob));
      // En eski görüntüler atılır
      while (snapshots.size > SNAPSHOT_LIMIT) {
        const [first, url] = snapshots.entries().next().value!;
        snapshots.delete(first);
        URL.revokeObjectURL(url);
      }
    },
    "image/jpeg",
    0.7,
  );
}

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
  annotation: PageExtras;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  // Sayfanın kendi en/boy oranı (sayfalar arasında küçük farklar olabiliyor)
  const [aspect, setAspect] = useState<number | null>(null);
  // Çizilecek genişlik: yakınlaştırma durunca güncellenir
  const [target, setTarget] = useState(width);
  // Ekranda gösterilen, çizimi tamamlanmış genişlik
  const [shown, setShown] = useState<number | null>(null);
  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null);
  const ocr = useOcr(annotation.bookKey, pdfPage, annotation.ocr && visible);

  const snapshotKey = `${annotation.bookKey}:${pageNumber}`;
  const keyRef = useRef(snapshotKey);
  useEffect(() => {
    keyRef.current = snapshotKey;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Önceden yükleme payı ancak kaydırma kutusu root olursa işe yarar
    const root = el.closest("[data-scroll-root]");
    const near = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      { root, rootMargin: MOUNT_MARGIN },
    );
    const far = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) return;
        // Canvas atılmadan önce görüntüsü alınır
        const canvas = el.querySelector<HTMLCanvasElement>("div:not(.invisible) > .react-pdf__Page canvas");
        if (canvas) saveSnapshot(keyRef.current, canvas);
        setVisible(false);
        setShown(null);
      },
      { root, rootMargin: UNMOUNT_MARGIN },
    );
    near.observe(el);
    far.observe(el);
    return () => {
      near.disconnect();
      far.disconnect();
    };
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
  // Henüz çizilmediyse ve önceden alınmış görüntüsü varsa çizim bitene kadar o görünür
  const snapshot = shown === null ? snapshots.get(snapshotKey) : undefined;

  return (
    <figure ref={ref} data-page-number={pageNumber} className="mx-auto">
      <div
        style={{ width, height: frameHeight }}
        className="page-frame relative overflow-hidden"
      >
        {snapshot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={snapshot} alt="" className="absolute inset-0 h-full w-full [filter:var(--page-filter)]" />
        )}
        {visible &&
          layers.map((w) => {
            const pending = shown === null ? !!snapshot : w !== shown;
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
                  onLoadSuccess={(page) => {
                    setAspect(page.originalHeight / page.originalWidth);
                    setPdfPage(page);
                  }}
                  onRenderSuccess={() => setShown(w)}
                  renderAnnotationLayer
                  renderTextLayer
                />
              </div>
            );
          })}
        {visible && ocr.status === "done" && (
          <OcrTextLayer data={ocr.data} width={width} height={frameHeight} />
        )}
        {ocr.status === "loading" && (
          <span className="pointer-events-none absolute top-2 right-2 z-20 bg-sheet/90 px-2 py-0.5 text-[11px] text-muted">
            Metin tanınıyor…
          </span>
        )}
        {ocr.status === "error" && (
          <span className="pointer-events-none absolute top-2 right-2 z-20 bg-sheet/90 px-2 py-0.5 text-[11px] text-accent">
            Metin tanınamadı
          </span>
        )}
        {visible && (
          <HighlightLayer
            book={annotation.bookKey}
            page={pageNumber}
            width={width}
            height={frameHeight}
            tool={annotation.tool}
            onAsk={annotation.onAskHighlight}
          />
        )}
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
        {visible && <AiCursor page={pageNumber} width={width} />}
        {visible && annotation.onCrop && (
          <CropLayer page={pageNumber} onCrop={annotation.onCrop} />
        )}
      </div>
      <figcaption className="mt-2 text-center text-xs tabular-nums text-muted">
        {pageNumber}
      </figcaption>
    </figure>
  );
}

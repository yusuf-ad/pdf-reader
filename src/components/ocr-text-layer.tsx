"use client";

import { useT } from "@/lib/i18n";
import { Fragment, useMemo } from "react";
import type { OcrPage } from "@/lib/ocr";

const FONT = "sans-serif";
let measureCtx: CanvasRenderingContext2D | null = null;

function measure(text: string, size: number) {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  measureCtx.font = `${size}px ${FONT}`;
  return measureCtx.measureText(text).width;
}

/**
 * OCR ile tanınan kelimeler için görünmez, seçilebilir metin katmanı.
 * pdf.js metin katmanı gibi: kelimeler şeffaf <span>'ler, satır sonları <br>;
 * böylece seçim/çeviri kodu (selection.ts) iki katmanda da aynı çalışır.
 */
export default function OcrTextLayer({ data, width, height }: { data: OcrPage; width: number; height: number }) {
  const t = useT("reader");
  // Ölçüm sayfa genişliğinden bağımsız: 100px'lik yazıya göre oranlanır
  const lines = useMemo(
    () =>
      data.lines.map((words) => {
        const top = Math.min(...words.map((w) => w.b[1]));
        const bottom = Math.max(...words.map((w) => w.b[3]));
        return {
          top,
          size: bottom - top,
          words: words.map((w, i) => {
            const text = i < words.length - 1 ? `${w.t} ` : w.t;
            return { text, x: w.b[0], w: w.b[2] - w.b[0], natural: measure(w.t, 100) / 100 };
          }),
        };
      }),
    [data],
  );

  return (
    <div className="ocr-layer absolute inset-0 z-[5]" aria-label={t("ocrRecognizedText")}>
      {lines.map((line, li) => {
        const fontSize = line.size * height;
        return (
          <Fragment key={li}>
            {line.words.map((word, wi) => (
              <span
                key={wi}
                style={{
                  left: word.x * width,
                  top: line.top * height,
                  fontSize,
                  lineHeight: `${fontSize}px`,
                  // Kelimenin sayfadaki genişliğine sığdır (sondaki boşluk hariç)
                  transform: `scaleX(${(word.w * width) / Math.max(1, word.natural * fontSize)})`,
                }}
              >
                {word.text}
              </span>
            ))}
            <br />
          </Fragment>
        );
      })}
    </div>
  );
}

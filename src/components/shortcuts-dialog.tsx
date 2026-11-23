"use client";

import { useEffect } from "react";
import { openOnboarding } from "./onboarding";

const TEXT = {
  title: "Kısayollar",
  gettingStarted: "Başlarken",
  description: "Vurgula, not al ve yapay zekâya sor: dört kısa ipucuyla başla.",
  restart: "Tanıtım turunu yeniden aç",
} as const;

const SHORTCUTS: [string, string][] = [
  ["Ctrl + K", "Seçili metin hakkında sor (sohbet)"],
  ["L", "Kitaplık (Esc ile okumaya dön)"],
  ["→  /  ←", "Sonraki / önceki sayfa"],
  ["Home  /  End", "İlk / son sayfa"],
  ["G", "Sayfa numarasına git"],
  ["Ctrl + F", "Belgede ara"],
  ["Enter  /  Shift + Enter", "Sonraki / önceki arama sonucu"],
  ["Ctrl + +  /  Ctrl + −", "Yakınlaştır / uzaklaştır"],
  ["Ctrl + 0", "Yakınlaştırmayı sıfırla"],
  ["Ctrl + tekerlek", "Fareyle yakınlaştır"],
  ["W  /  P", "Genişliğe / sayfaya sığdır"],
  ["B", "Bu sayfayı yer imlerine ekle / çıkar"],
  ["F", "Odak modu (tam ekran, paneller gizli)"],
  ["[  /  ]", "Sol paneli / kelime listesini aç-kapat"],
  ["Çift tık", "Kelimeyi seç ve çevir"],
  ["H", "Seçili metni vurgula (vurguya tıkla: renk, sor, sil)"],
  ["D  /  M  /  T  /  E", "Kalem / fosforlu kalem / yazı ekle / silgi (Esc ile bırak)"],
  ["Shift + sürükle", "Fosforlu kalemle düz çizgi"],
  ["Sağ tık basılı", "Kalem / yazı açıkken geçici silgi"],
  ["N", "Notlar kâğıdı: eski notlar, arama, sabitleme (başlığından sürükle)"],
  ["Q", "Yapamadığım soruyu sayfadan kırp (Enter: kaydet, Ctrl K: sohbete sor)"],
  ["Ctrl + V", "Ekran görüntüsünü yapamadığım soru olarak ya da PDF'e ekle"],
  ["Ctrl + Z", "Son çizimi / yazıyı / vurguyu geri al"],
  ["Ctrl + S", "Notları PDF'e yazıp kaydet (son kaydedilen dosyaya)"],
  ["Ctrl + Shift + S", "Farklı kaydet (yeni yer seç)"],
  ["Esc", "Açık pencereyi kapat"],
  ["?", "Bu listeyi göster"],
];

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-label={TEXT.title} className="max-h-[calc(100dvh-2rem)] w-[440px] max-w-[calc(100vw-2rem)] overflow-y-auto border border-rule bg-sheet p-6 shadow-[0_8px_30px_var(--shadow)]">
        <h2 className="font-serif text-xl">{TEXT.title}</h2>
        <section className="mt-4 border-y border-rule py-4">
          <h3 className="font-serif text-lg">{TEXT.gettingStarted}</h3>
          <p className="mt-1 text-sm text-muted">{TEXT.description}</p>
          <button onClick={() => { onClose(); openOnboarding(); }} className="mt-2 text-sm underline underline-offset-4 hover:text-accent">{TEXT.restart}</button>
        </section>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="contents">
              <dt className="font-mono text-xs leading-5 whitespace-nowrap text-muted">{keys}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

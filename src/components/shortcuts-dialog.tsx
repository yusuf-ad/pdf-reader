"use client";

import { useEffect } from "react";

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
  ["D  /  T  /  E", "Kalem / yazı ekle / silgi (Esc ile bırak)"],
  ["Sağ tık basılı", "Kalem / yazı açıkken geçici silgi"],
  ["Ctrl + Z", "Son çizimi / yazıyı / vurguyu geri al"],
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-label="Kısayollar" className="w-[440px] border border-rule bg-sheet p-6 shadow-[0_8px_30px_var(--shadow)]">
        <h2 className="font-serif text-xl">Kısayollar</h2>
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

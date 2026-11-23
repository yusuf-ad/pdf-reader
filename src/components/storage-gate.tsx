"use client";

import { useT } from "@/lib/i18n";

import { useEffect, useState, type ReactNode } from "react";
import { migrateLibrary } from "@/lib/file-store";
import { requestPersistence, whenReady } from "@/lib/storage";

// Kayıtlı veriler (notlar, kelimeler…) belleğe yüklenmeden uygulama açılmasın: açılırsa
// boş görünür, o arada yapılan değişiklik de eski kayıtların üzerine yazılabilir.
export default function StorageGate({ children }: { children: ReactNode }) {
  const t = useT("library");
  const [state, setState] = useState<"loading" | "migrating" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    whenReady()
      .then(async () => {
        requestPersistence();
        // Eski anahtarlı kitaplar içerik anahtarına çevrilir; hata olursa uygulama yine açılır
        await migrateLibrary(() => active && setState("migrating")).catch((err) => console.error("Kitaplık taşınamadı:", err));
        if (active) setState("ready");
      })
      .catch((err) => {
        console.error(err);
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  if (state === "ready") return children;
  return (
    <div className="flex h-full items-center justify-center bg-paper px-8 text-sm text-muted">
      {state === "error"
        ? t("storageError")
        : state === "migrating"
          ? t("storageMigrating")
          : null}
    </div>
  );
}

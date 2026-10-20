"use client";

import { useEffect } from "react";

// Service worker yalnızca üretim derlemesinde kaydedilir; geliştirirken önbellek eski
// kodu gösterip kafa karıştırmasın.
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // Daha önce üretim derlemesinden kalan worker, geliştirmede eski betikleri vermesin
      navigator.serviceWorker
        .getRegistrations()
        .then(async (regs) => {
          if (!regs.length) return;
          await Promise.all(regs.map((r) => r.unregister()));
          await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
          location.reload();
        })
        .catch(() => {});
      return;
    }
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}

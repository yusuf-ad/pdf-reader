"use client";

import { useEffect } from "react";

// Service worker yalnızca üretim derlemesinde kaydedilir; geliştirirken önbellek eski
// kodu gösterip kafa karıştırmasın.
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}

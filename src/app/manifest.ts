import type { MetadataRoute } from "next";

// Uygulama olarak kurulabilmesi için (masaüstü ve telefon ana ekranı).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Okuma",
    short_name: "Okuma",
    description: "Seçtiğin kelimeleri Türkçeye çeviren PDF okuyucu",
    lang: "tr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ece8df",
    theme_color: "#ece8df",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    // Kurulu uygulamada PDF'ler "Birlikte aç" ile açılabilsin (Chrome/Edge masaüstü)
    file_handlers: [{ action: "/", accept: { "application/pdf": [".pdf"] } }],
  };
}

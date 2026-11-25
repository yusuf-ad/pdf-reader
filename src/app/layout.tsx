import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import Script from "next/script";
import ServiceWorker from "@/components/service-worker";
import DesktopHint from "@/components/desktop-hint";
import { THEME_RENAMES, THEME_STORAGE_KEY } from "@/lib/theme";
import { langScript } from "@/lib/i18n/lang-script";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
});

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Okuma",
  description: "A PDF reader for highlighting, taking notes, and translating words in context",
  applicationName: "Okuma",
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
  appleWebApp: { capable: true, title: "Okuma", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ece8df",
};

// Sayfa boyanmadan önce kayıtlı temayı uygula (açılışta parlama olmasın)
const themeScript = `try{var k=${JSON.stringify(THEME_STORAGE_KEY)},m=${JSON.stringify(THEME_RENAMES)},t=localStorage.getItem(k);if(t&&m[t]){t=m[t];localStorage.setItem(k,t)}if(!t&&matchMedia("(prefers-color-scheme: dark)").matches)t="night";document.documentElement.dataset.theme=t||"light"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${newsreader.variable} ${plex.variable} h-full antialiased`}
    >
      <body className="app-shell">
        {/* beforeInteractive: sunucu HTML'ine eklenir, sayfa boyanmadan çalışır */}
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <Script id="lang" strategy="beforeInteractive">
          {langScript}
        </Script>
        <DesktopHint />
        <div className="app-content">{children}</div>
        <ServiceWorker />
        {/* Gece teması sayfa filtresi: aydınlığı ters çevirir ama renk tonunu korur, sonucu
            tam olarak sayfa zemini (#1d2129) ile yazı rengi (#d8d4cb) arasına yerleştirir */}
        <svg aria-hidden width="0" height="0" className="absolute">
          <filter id="night-page" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0.4215 -1.049 -0.1059 0 0.8471  -0.2985 -0.3021 -0.1014 0 0.8314  -0.2701 -0.9087 0.5436 0 0.7961  0 0 0 1 0"
            />
          </filter>
        </svg>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import Script from "next/script";
import { THEME_STORAGE_KEY } from "@/lib/theme";
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
  description: "Seçtiğin kelimeleri Türkçeye çeviren PDF okuyucu",
};

// Sayfa boyanmadan önce kayıtlı temayı uygula (açılışta parlama olmasın)
const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(!t&&matchMedia("(prefers-color-scheme: dark)").matches)t="night";document.documentElement.dataset.theme=t||"light"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      suppressHydrationWarning
      className={`${newsreader.variable} ${plex.variable} h-full antialiased`}
    >
      <body className="h-full">
        {/* beforeInteractive: sunucu HTML'ine eklenir, sayfa boyanmadan çalışır */}
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
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

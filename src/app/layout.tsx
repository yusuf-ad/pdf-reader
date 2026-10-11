import type { Metadata } from "next";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
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
const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(!t&&matchMedia("(prefers-color-scheme: dark)").matches)t="dark";document.documentElement.dataset.theme=t||"light"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      suppressHydrationWarning
      className={`${newsreader.variable} ${plex.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}

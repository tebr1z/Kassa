import type { Metadata } from "next";
import "./globals.css";
import "./language-switcher.css";
import "./invoice-print.css";
import {LanguageProvider} from "@/lib/language";
import {siteUrl} from '@/lib/seo';
import {indexingRobots} from '@/lib/seo-server';

export async function generateMetadata():Promise<Metadata>{return {
  metadataBase:new URL(siteUrl()),
  title: {default:"RestaMarket — Restoran və mətbəx ləvazimatları",template:"%s | RestaMarket"},
  description: "Restoran və mətbəx ləvazimatları RestaMarket-də. Məhsullara, ölçülərə və qiymətlərə baxın, onlayn sifariş edin.",
  robots:await indexingRobots(),
  verification:process.env.GOOGLE_SITE_VERIFICATION?{google:process.env.GOOGLE_SITE_VERIFICATION}:undefined,
  icons: {
    icon: "/restamarket-mark.svg",
    shortcut: "/restamarket-mark.svg",
    apple: "/restamarket-apple.png",
  },
};}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="az">
      <body className="antialiased"><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BirKassa — Ticarət və anbar sistemi",
  description: "Satış, anbar, sifariş, maliyyə və işçi idarəetməsi.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="az">
      <body className="antialiased">{children}</body>
    </html>
  );
}

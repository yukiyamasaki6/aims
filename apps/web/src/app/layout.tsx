import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AIMS",
  description: "AIMS Web Application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${geistSans.variable} ${geistMono.variable}`}>
      {/* h-screen（100vh）はモバイルブラウザのアドレスバー等の出し入れによる
          実際の可視高さの変化に追従せず、下部要素が隠れることがある。
          h-dvh（動的ビューポート高さ）にすることで実際に見えている範囲に
          常に一致させる。 */}
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  );
}

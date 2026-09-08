import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      {/* h-screen（100vh）はモバイルブラウザのアドレスバー等の出し入れによる
          実際の可視高さの変化に追従せず、下部要素が隠れることがある。
          h-dvh（動的ビューポート高さ）にすることで実際に見えている範囲に
          常に一致させる。 */}
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  );
}

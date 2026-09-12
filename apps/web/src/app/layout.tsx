import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIMS",
  description: "AIMS Web Application",
};

// interactiveWidget: "resizes-content" により、モバイルのソフトキーボード
// 展開時にレイアウトビューポート自体を縮めさせる。これによりh-dvh・
// position: fixedで中央寄せしているDialog等が、キーボードに隠れず
// 可視領域の下端に合わせて縮む（対応ブラウザのみ。Android Chromeは対応、
// iOS Safariは非対応のため実機確認が必要）。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={GeistSans.variable}>
      {/* h-screen（100vh）はモバイルブラウザのアドレスバー等の出し入れによる
          実際の可視高さの変化に追従せず、下部要素が隠れることがある。
          h-dvh（動的ビューポート高さ）にすることで実際に見えている範囲に
          常に一致させる。 */}
      <body className="h-dvh overflow-hidden">{children}</body>
    </html>
  );
}

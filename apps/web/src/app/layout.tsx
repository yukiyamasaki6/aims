import { SerwistProvider } from "@serwist/next/react";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIMS",
  description: "AIMS Web Application",
  manifest: "/manifest.webmanifest",
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
      <body className="h-dvh overflow-hidden">
        <SerwistProvider
          swUrl="/sw.js"
          disable={process.env.NODE_ENV !== "production"}
          // sw.tsはページをキャッシュしないため、reloadOnOnlineの本来の
          // 目的（古いキャッシュ済みページの最新化）はそもそも発生しない。
          // さらに送信キュー（use-sync-queue）が`online`イベント検知で
          // 既にリロード無しの再送を行っているため、trueのままだと目的の
          // 重複に加え、展開中のパネルや入力中の下書きを毎回失わせる
          // だけの余計な副作用になる。
          reloadOnOnline={false}
          // ページ（HTML/RSC）はsw.ts側でNetworkOnlyにしておりキャッシュ
          // 対象外のため、デフォルトのtrueのままだとナビゲーションのたびに
          // 何もキャッシュしない無駄なリクエストが余計に発生してしまう。
          cacheOnNavigation={false}
        >
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}

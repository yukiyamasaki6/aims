import { SerwistProvider } from "@serwist/next/react";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { createTranslator } from "next-intl";
import { intlConfig } from "@/i18n/messages";
import { SW_PATH } from "@/routes";
import "./globals.css";
import { RootClientEntry } from "./root-client-entry";

// 静的なまま、文言の設定から解決する。
const t = createTranslator({ ...intlConfig, namespace: "shared" });

export const metadata: Metadata = {
  title: t("appName"),
  description: t("appDescription"),
};

// interactiveWidget: "resizes-content" により、モバイルのソフトキーボード
// 展開時にレイアウトビューポート自体を縮めさせる。これにより--app-height
// （既定は100dvh）・position: fixedで中央寄せしているDialog等が、キーボードに隠れず
// 可視領域の下端に合わせて縮む（対応ブラウザのみ。Android Chromeは対応、
// iOS Safariは非対応のため実機確認が必要）。
export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={GeistSans.variable}>
      {/* アプリ全体が描かれる領域の高さは、根の枠であるこのbodyだけが
          --app-heightで決め、画面はその高さに従う。既定は100dvh（動的
          ビューポート高さ。h-screenの100vhはアドレスバー等の出し入れに追従
          せず、下部要素が隠れることがある）で、スタンドアロンでは
          useAppHeightが実測した可視高さに差し替える。 */}
      <body className="h-(--app-height) overflow-hidden">
        <RootClientEntry>
          <SerwistProvider
            swUrl={SW_PATH}
            disable={process.env.NODE_ENV !== "production"}
            // sw.tsはページ内容をキャッシュしない（枠はプリキャッシュで配り、
            // 内容は枠内で取得する）ため、reloadOnOnlineの本来の目的（古い
            // キャッシュ済みページの最新化）はそもそも発生しない。
            // さらに操作の列の常駐の送信（同期の契機の受け取り）が`online`イベント検知で
            // 既にリロード無しの再送を行っているため、trueのままだと目的の
            // 重複に加え、展開中のパネルや入力中の下書きを毎回失わせる
            // だけの余計な副作用になる。
            reloadOnOnline={false}
            // ページ（HTML/RSC）はランタイムキャッシュの対象外（枠はプリ
            // キャッシュ、それ以外はNetworkOnly）のため、デフォルトのtrueの
            // ままだとナビゲーションのたびに何もキャッシュしない無駄な
            // リクエストが余計に発生してしまう。
            cacheOnNavigation={false}
          >
            {children}
          </SerwistProvider>
        </RootClientEntry>
      </body>
    </html>
  );
}

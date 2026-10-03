import { RoundDetailClient } from "./round-detail-client";

// /rounds/[id]を静的な枠にするため、プレースホルダーだけをプリレンダーする。実際のIDはクライアントがpathnameから得る。
// /rounds/<ID>はnext.configのrewriteで/rounds/_の枠へ向けるため、未知のIDは動的ルートに届かない。
// dynamicParams=falseで、rewriteが壊れてIDごとのHTMLが生成され続けるのを防ぐ。
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function RoundPage() {
  return <RoundDetailClient />;
}

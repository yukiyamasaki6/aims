import { ROUND_FRAME_ID } from "@/features/rounds/domain/round-routes";
import { RoundDetailClient } from "@/features/rounds/ui/round-detail-client";

// /rounds/[id]を静的な枠にするため、プレースホルダーだけをプリレンダーする。実際のIDはクライアントがpathnameから得る。
// /rounds/<ID>はnext.configのrewriteで/rounds/_の枠へ向けるため、未知のIDは動的ルートに届かない。
// dynamicParams=falseで、rewriteが壊れてIDごとのHTMLが生成され続けるのを防ぐ。
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ id: ROUND_FRAME_ID }];
}

export default function RoundPage() {
  return <RoundDetailClient />;
}

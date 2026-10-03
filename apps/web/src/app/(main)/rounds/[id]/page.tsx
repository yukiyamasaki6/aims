import { RoundDetailClient } from "./round-detail-client";

// /rounds/[id]を静的な枠にするため、プレースホルダーだけをプリレンダーする。実際のIDはクライアントがpathnameから得る。
// dynamicParams=falseにすると、オンラインで未知のIDが404になるため既定のままにする。
export function generateStaticParams() {
  return [{ id: "_" }];
}

export default function RoundPage() {
  return <RoundDetailClient />;
}

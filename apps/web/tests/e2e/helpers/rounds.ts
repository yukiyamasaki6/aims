import type { Page } from "@playwright/test";

const DEFAULT_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001"; // 10点的（アウトドア・122cm）
export const SIX_RING_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000003"; // 6点的（アウトドア・80cm）: X,10,9,8,7,6,5のみ
export const TRIPLE_SPOT_TARGET_FACE_ID =
  "a1000000-0000-0000-0000-000000000008"; // 6点的（インドア・40cm・3つ目トライアングル）: 3スポット、各スポット同一のX,10,9,8,7,6
// フィールド的（80cm）: 6,5が黄・4,3,2,1が黒。WA標準的の得点しきい値（9以上=黄,
// 7-8=赤,5-6=青,3-4=黒,1-2=白）とは対応しない配色のため、色が的の実際の
// リング色に追従しているかの検証に使う。
export const FIELD_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000010";

// スコア入力等のUI検証には/rounds/newのプリセット選択では用意できない任意の
// 距離構成（少エンド・少射数）が必要なため、/api/e2e/create-round経由で直接作成する。
export async function createRoundViaApi(
  page: Page,
  input: {
    name: string;
    roundDate: string;
    format?: string;
    bowType?: string;
    distances: {
      distance: number;
      totalEnds: number;
      arrowsPerEnd: number;
      targetFaceId?: string;
    }[];
  },
): Promise<string> {
  const response = await page.request.post("/api/e2e/create-round", {
    data: {
      name: input.name,
      roundDate: input.roundDate,
      format: input.format ?? "outdoor",
      bowType: input.bowType ?? "recurve",
      distances: input.distances.map((d) => ({
        distance: d.distance,
        total_ends: d.totalEnds,
        arrows_per_end: d.arrowsPerEnd,
        target_face_id: d.targetFaceId ?? DEFAULT_TARGET_FACE_ID,
      })),
    },
  });

  const { roundId } = await response.json();
  return roundId;
}

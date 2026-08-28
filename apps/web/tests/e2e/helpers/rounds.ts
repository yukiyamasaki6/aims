import type { Page } from "@playwright/test";

const DEFAULT_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001"; // 10点的（アウトドア・122cm）

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
        target_face_id: DEFAULT_TARGET_FACE_ID,
      })),
    },
  });

  const { roundId } = await response.json();
  return roundId;
}

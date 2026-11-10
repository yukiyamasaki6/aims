import { type Preset, presetDistancesInOrder } from "./preset";
import type { SyncOperation } from "./sync-events";

// 作成の操作の型。開始の手続きもこの型を使う(導出を1か所にする)。
export type RoundCreated = Extract<SyncOperation, { type: "round.created" }>;
type CreatedDistance = RoundCreated["distances"][number];

// 作成の操作から、新しく振るID(操作とラウンドと各距離のID)を除いたもの。
export type RoundCreatedDraft = Omit<
  RoundCreated,
  "eventId" | "roundId" | "distances"
> & {
  distances: Omit<CreatedDistance, "eventId" | "id">[];
};

// 選択したプリセット(無ければnull)から作成の内容を組み立てる。無ければ屋外・リカーブの距離無し。距離は位置の順。実施日は、nowに端末の時差(`utcOffsetMinutes`。東が正、分)を足した日付、つまり端末のローカルの日付。
// IDは持たない(乱数は外部の値のため、手続きが振る)。
export function roundCreatedDraftOf(
  preset: Preset | null,
  now: number,
  utcOffsetMinutes: number,
): RoundCreatedDraft {
  return {
    type: "round.created",
    name: "",
    // 時差を足した時刻のUTC表現の日付部分が、ローカルの日付になる(環境のタイムゾーンに触れない)。
    roundDate: new Date(now + utcOffsetMinutes * 60_000)
      .toISOString()
      .slice(0, 10),
    format: preset?.format ?? "outdoor",
    bowType: preset?.bow_type ?? "recurve",
    distances: preset
      ? presetDistancesInOrder(preset).map((d) => ({
          positionKey: d.position_key,
          distance: d.distance,
          isMarked: d.is_marked,
          totalEnds: d.total_ends,
          arrowsPerEnd: d.arrows_per_end,
          targetFaceId: d.target_face_id,
        }))
      : [],
  };
}

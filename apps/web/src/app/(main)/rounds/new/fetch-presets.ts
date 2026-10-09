import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FALLBACK_WAIT_MS,
  FETCH_TIMEOUT_MS,
  fetchContent,
} from "@/features/fetch-result/fetch-content";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { ROUND_PRESET_SELECT } from "../_shared/reference-query-constants";
import {
  loadReferenceSnapshot,
  saveReferenceSnapshot,
  updateReferenceSnapshot,
} from "../_shared/reference-snapshot";
import { comparePresets } from "./compare-presets";
import type { Preset, PresetWithMeta } from "./preset-types";

export type FetchedPresets = { personal: Preset[]; global: Preset[] };

// preset_distances.target_facesはFKの多重度（多対1）上つねに単一のオブジェクトだが、
// 生成型は入れ子embedのカーディナリティを配列として広く推論するため、実体に合わせてキャストする。
function toFetchedPresets(rows: unknown[] | null): FetchedPresets {
  const presets = ((rows ?? []) as unknown as PresetWithMeta[]).sort(
    comparePresets,
  );
  return {
    personal: presets.filter((p) => p.owner_id !== null),
    global: presets.filter((p) => p.owner_id === null),
  };
}

// 取得できたら最新で端末へ保存して返す。取得できないとき（オフライン・通信失敗・エラー・
// FALLBACK_WAIT_MS内に終わらない）は、保存済みがあればそれを返す。保存済みが無ければ結果をそのまま返す。
// 時間切れの後に届いた結果は表示せず、保存だけする。
// preset_roundsのRLSは認証済みの全員に全行を見せるため、他人の個人プリセットを除くクエリの絞りが必須である。
export async function fetchPresets(
  supabase: SupabaseClient<Database>,
): Promise<FetchResult<FetchedPresets>> {
  const startedAt = Date.now();
  const saved = loadReferenceSnapshot<FetchedPresets>("presets");
  let queriedUserId: string | undefined;
  const result = await fetchContent(
    supabase as SupabaseClient,
    async (session) => {
      const userId = session.user.id;
      queriedUserId = userId;
      return supabase
        .from("preset_rounds")
        .select(ROUND_PRESET_SELECT)
        .or(`owner_id.is.null,owner_id.eq.${userId}`)
        .retry(false);
    },
    {
      timeoutMs: saved ? FALLBACK_WAIT_MS : FETCH_TIMEOUT_MS,
      onLateResult: (late) => {
        if (late.status === "ok" && queriedUserId) {
          saveReferenceSnapshot(
            "presets",
            queriedUserId,
            toFetchedPresets(late.data),
            startedAt,
          );
        }
      },
    },
  );
  if (result.status !== "ok") {
    return saved ? { status: "ok", data: saved } : result;
  }
  const data = toFetchedPresets(result.data);
  if (queriedUserId) {
    saveReferenceSnapshot("presets", queriedUserId, data, startedAt);
  }
  return { status: "ok", data };
}

// 個人プリセットの削除が成功したら、保存済みからも除く。
export function deletePresetFromSnapshot(presetId: string): void {
  updateReferenceSnapshot<FetchedPresets>("presets", (d) => ({
    ...d,
    personal: d.personal.filter((p) => p.id !== presetId),
  }));
}

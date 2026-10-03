import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import { fetchContent } from "@/features/fetch-result/fetch-content";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { ROUND_PRESET_SELECT } from "../_shared/reference-query-constants";
import { comparePresets } from "./compare-presets";
import type { Preset, PresetWithMeta } from "./preset-types";

export type FetchedPresets = { personal: Preset[]; global: Preset[] };

// preset_roundsのRLSは認証済みの全員に全行を見せるため、他人の個人プリセットを除くクエリの絞りが必須である。
export async function fetchPresets(
  supabase: SupabaseClient<Database>,
): Promise<FetchResult<FetchedPresets>> {
  const result = await fetchContent(supabase as SupabaseClient, async () => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) {
      return {
        data: null,
        error: { code: "PGRST301", message: AUTH_REQUIRED_MESSAGE },
        status: 401,
      };
    }
    return supabase
      .from("preset_rounds")
      .select(ROUND_PRESET_SELECT)
      .or(`owner_id.is.null,owner_id.eq.${userId}`)
      .retry(false);
  });
  if (result.status !== "ok") return result;

  // preset_distances.target_facesはFKの多重度（多対1）上つねに単一のオブジェクトだが、
  // 生成型は入れ子embedのカーディナリティを配列として広く推論するため、実体に合わせてキャストする。
  const presets = ((result.data ?? []) as unknown as PresetWithMeta[]).sort(
    comparePresets,
  );
  return {
    status: "ok",
    data: {
      personal: presets.filter((p) => p.owner_id !== null),
      global: presets.filter((p) => p.owner_id === null),
    },
  };
}

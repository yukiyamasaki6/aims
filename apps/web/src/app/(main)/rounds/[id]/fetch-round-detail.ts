import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import { fetchContent } from "@/features/fetch-result/fetch-content";
import type {
  FetchResult,
  ResponseLike,
} from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { TARGET_FACE_SELECT } from "../_shared/reference-query-constants";
import type { TargetFaceOption } from "./distance-config-row";
import type { RoundConfig } from "./round-config";
import type { Distance, Shot } from "./scorecard-types";

export type RoundDetail = {
  roundConfig: RoundConfig;
  distances: Distance[];
  shots: Shot[];
  targetFaces: TargetFaceOption[];
};

const ROUND_SELECT =
  "id, name, round_date, format, bow_type, distances(id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, shots(distance_id, end_number, arrow_number, shooter_id, score_str, score_int))";

type RoundRow = {
  name: string;
  round_date: string;
  format: string;
  bow_type: string;
  distances: (Distance & { shots: Shot[] })[];
};

type TargetFaceRow = TargetFaceOption & { owner_id: string | null };

type Fetched = { round: RoundRow; targetFaces: TargetFaceRow[] };

type Response = ResponseLike<unknown>;

// 複数の取得を1つの結果に畳むときの優先順。通信失敗→未認証→その他のエラー。
function failureOf(responses: Response[]): Response | undefined {
  const failed = responses.filter((r) => r.status === 0 || r.error);
  return (
    failed.find((r) => r.status === 0) ??
    failed.find((r) => r.status === 401 || r.error?.code === "PGRST301") ??
    failed[0]
  );
}

// 個人の的を先に、それぞれ種類(outdoor→indoor→field)→サイズ(大→小)→名前の順に並べる。名前の比較はDBの照合順序でなくJSの比較で、この並びは意図した規則である。
function compareTargetFaces(a: TargetFaceRow, b: TargetFaceRow): number {
  const personal = Number(b.owner_id !== null) - Number(a.owner_id !== null);
  if (personal !== 0) return personal;
  if (a.format !== b.format) return a.format < b.format ? 1 : -1;
  if (a.size !== b.size) return b.size - a.size;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

// 存在しない・権限なし・論理削除済みはいずれもroundがnullになり、区別しない。
// target_facesのRLSは認証済みの全員に全行を見せるため、他人の個人の的を除くクエリの絞りが必須である。
export async function fetchRoundDetail(
  supabase: SupabaseClient<Database>,
  roundId: string,
): Promise<FetchResult<RoundDetail>> {
  const result = await fetchContent<Fetched>(
    supabase as SupabaseClient,
    async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) {
        return {
          data: null,
          error: { code: "PGRST301", message: AUTH_REQUIRED_MESSAGE },
          status: 401,
        };
      }
      const [round, faces] = await Promise.all([
        supabase
          .from("rounds")
          .select(ROUND_SELECT)
          .eq("id", roundId)
          .is("disabled_at", null)
          .is("distances.disabled_at", null)
          .is("distances.shots.disabled_at", null)
          .order("position_key", { referencedTable: "distances" })
          .order("id", { referencedTable: "distances" })
          .maybeSingle()
          .retry(false),
        supabase
          .from("target_faces")
          .select(TARGET_FACE_SELECT)
          .or(`owner_id.is.null,owner_id.eq.${userId}`)
          .retry(false),
      ]);
      const failure = failureOf([round, faces]);
      if (failure) return failure as ResponseLike<Fetched>;
      return {
        data: round.data
          ? {
              round: round.data as unknown as RoundRow,
              targetFaces: (faces.data ?? []) as unknown as TargetFaceRow[],
            }
          : null,
        error: null,
        status: 200,
      };
    },
    { nullIsNotFound: true },
  );
  if (result.status !== "ok") return result;

  const { round, targetFaces } = result.data;
  return {
    status: "ok",
    data: {
      roundConfig: {
        name: round.name,
        roundDate: round.round_date,
        format: round.format,
        bowType: round.bow_type,
      },
      distances: round.distances.map(
        ({ shots: _shots, ...distance }) => distance,
      ),
      shots: round.distances.flatMap((d) => d.shots),
      targetFaces: [...targetFaces].sort(compareTargetFaces),
    },
  };
}

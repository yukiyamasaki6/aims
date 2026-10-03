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

type RoundDetail = {
  roundConfig: RoundConfig;
  distances: Distance[];
  shots: Shot[];
  targetFaces: TargetFaceOption[];
};

// 対象ごとに、サーバーが確定した最新のrevision。取り消した矢と無効化した距離の行も含む。
// 画面を開く前に確定した操作が、取得に反映済みかを判定する(load-round-detail.ts)。
export type RoundRevisions = {
  round: number;
  // 距離IDごと。
  distances: Record<string, number>;
  // `shotRevisionKey`ごと。
  shots: Record<string, number>;
};

export type FetchedRoundDetail = RoundDetail & { revisions: RoundRevisions };

export function shotRevisionKey(
  distanceId: string,
  endNumber: number,
  arrowNumber: number,
): string {
  return `${distanceId}:${endNumber}:${arrowNumber}`;
}

// 無効化した距離と取り消した矢の行も取得し、表示にはdisabled_atが無い行だけを使う。
const ROUND_SELECT =
  "id, name, round_date, format, bow_type, revision, distances(id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision, disabled_at, shots(distance_id, end_number, arrow_number, shooter_id, score_str, score_int, revision, disabled_at))";

type ShotRow = Shot & { revision: number; disabled_at: string | null };
type DistanceRow = Distance & {
  revision: number;
  disabled_at: string | null;
  shots: ShotRow[];
};

type RoundRow = {
  name: string;
  round_date: string;
  format: string;
  bow_type: string;
  revision: number;
  distances: DistanceRow[];
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

// 存在しない・権限なし・論理削除済みのラウンドは、いずれもroundがnullになり、区別しない。
// target_facesのRLSは認証済みの全員に全行を見せるため、他人の個人の的を除くクエリの絞りが必須である。
export async function fetchRoundDetail(
  supabase: SupabaseClient<Database>,
  roundId: string,
): Promise<FetchResult<FetchedRoundDetail>> {
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
  const revisions: RoundRevisions = {
    round: round.revision,
    distances: {},
    shots: {},
  };
  const distances: Distance[] = [];
  const shots: Shot[] = [];
  for (const row of round.distances) {
    const { shots: shotRows, revision, disabled_at, ...distance } = row;
    revisions.distances[distance.id] = revision;
    if (disabled_at === null) distances.push(distance);
    for (const shotRow of shotRows) {
      const {
        revision: shotRevision,
        disabled_at: shotDisabledAt,
        ...shot
      } = shotRow;
      revisions.shots[
        shotRevisionKey(shot.distance_id, shot.end_number, shot.arrow_number)
      ] = shotRevision;
      if (disabled_at === null && shotDisabledAt === null) shots.push(shot);
    }
  }
  return {
    status: "ok",
    data: {
      roundConfig: {
        name: round.name,
        roundDate: round.round_date,
        format: round.format,
        bowType: round.bow_type,
      },
      distances,
      shots,
      targetFaces: [...targetFaces].sort(compareTargetFaces),
      revisions,
    },
  };
}

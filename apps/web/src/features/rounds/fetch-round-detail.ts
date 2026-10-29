import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdentityReader, SessionReader } from "@/features/auth";
import {
  FALLBACK_WAIT_MS,
  FETCH_TIMEOUT_MS,
  fetchContent,
} from "@/features/fetch-result/fetch-content";
import {
  type FetchResult,
  isAuthRejected,
  type ResponseLike,
} from "@/features/fetch-result/fetch-result";
import type { Database } from "@/types/supabase";
import { TARGET_FACE_SELECT } from "./reference-query-constants";
import {
  loadReferenceSnapshot,
  saveReferenceSnapshot,
} from "./reference-snapshot";
import type { RoundConfig } from "./round-config";
import type { Distance, Shot } from "./scorecard-types";
import type { RoundStatus } from "./sync-events";
import type { TargetFaceOption } from "./target-face-types";

type RoundDetail = {
  roundConfig: RoundConfig;
  status: RoundStatus;
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
  // 矢のIDごと。
  shots: Record<string, number>;
};

// `startedAt`は取得の開始時刻、`userId`は取得に使ったセッションのユーザー。端末へ保存するベースの記録に付ける。
export type FetchedRoundDetail = RoundDetail & {
  revisions: RoundRevisions;
  startedAt: number;
  userId: string;
};

// 複数のラウンドの取得。`rounds`は返ったラウンドだけ(削除済みや権限のないラウンドは含まない)。
export type FetchedRoundDetails = {
  rounds: Map<string, FetchedRoundDetail>;
  startedAt: number;
  userId: string;
};

// 無効化した距離と取り消した矢の行も取得し、表示にはdisabled_atが無い行だけを使う。
const ROUND_SELECT =
  "id, name, round_date, format, bow_type, status, revision, distances(id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked, revision, disabled_at, shots(id, distance_id, end_number, shooter_id, score_str, score_int, shot_number, revision, disabled_at))";

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
  status: RoundStatus;
  revision: number;
  distances: DistanceRow[];
};

type TargetFaceRow = TargetFaceOption & { owner_id: string | null };

// `userId`は、問い合わせに使ったセッションのユーザー。
type Fetched = {
  round: RoundRow[];
  targetFaces: TargetFaceRow[];
  userId: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Response = ResponseLike<unknown>;

// 複数の取得を1つの結果に畳むときの優先順。通信失敗→未認証→その他のエラー。
function failureOf(responses: Response[]): Response | undefined {
  const failed = responses.filter((r) => r.status === 0 || r.error);
  return (
    failed.find((r) => r.status === 0) ??
    failed.find(isAuthRejected) ??
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

// target_facesのRLSは認証済みの全員に全行を見せるため、他人の個人の的を除くクエリの絞りが必須である。
function selectTargetFaces(supabase: SupabaseClient<Database>, userId: string) {
  return supabase
    .from("target_faces")
    .select(TARGET_FACE_SELECT)
    .or(`owner_id.is.null,owner_id.eq.${userId}`)
    .retry(false);
}

function sortedTargetFaces(rows: TargetFaceRow[]): TargetFaceOption[] {
  return [...rows].sort(compareTargetFaces);
}

// 的の一覧だけを取得する。作成が未確定のラウンドの読み込み(load-round-detail.ts)が、ラウンドの取得と別に的を得るために使う。
// 取得できたら最新で端末へ保存して返す。取得できないとき（FALLBACK_WAIT_MS内に終わらないときを含む）は、
// 保存済みがあればそれを返し、時間切れの後に届いた結果は表示せず保存だけする。
export async function fetchTargetFaces(
  supabase: SupabaseClient<Database>,
  sessionReader: SessionReader,
  identityReader: IdentityReader,
): Promise<FetchResult<TargetFaceOption[]>> {
  const startedAt = Date.now();
  const saved = loadReferenceSnapshot<TargetFaceOption[]>(
    identityReader,
    "target-faces",
  );
  let queriedUserId: string | undefined;
  const result = await fetchContent<TargetFaceRow[]>(
    sessionReader,
    async (session) => {
      const userId = session.userId;
      queriedUserId = userId;
      const faces = await selectTargetFaces(supabase, userId);
      if (faces.status === 0 || faces.error) {
        return faces as unknown as ResponseLike<TargetFaceRow[]>;
      }
      return {
        data: (faces.data ?? []) as unknown as TargetFaceRow[],
        error: null,
        status: 200,
      };
    },
    {
      timeoutMs: saved ? FALLBACK_WAIT_MS : FETCH_TIMEOUT_MS,
      onLateResult: (late) => {
        if (late.status === "ok" && queriedUserId) {
          saveReferenceSnapshot(
            "target-faces",
            queriedUserId,
            sortedTargetFaces(late.data),
            startedAt,
          );
        }
      },
    },
  );
  if (result.status !== "ok") {
    return saved ? { status: "ok", data: saved } : result;
  }
  const faces = sortedTargetFaces(result.data);
  if (queriedUserId) {
    saveReferenceSnapshot("target-faces", queriedUserId, faces, startedAt);
  }
  return { status: "ok", data: faces };
}

type RoundRowWithId = RoundRow & { id: string };

// ラウンドの取得の行を、記録の形にする。
function toRoundDetail(
  round: RoundRow,
  faces: TargetFaceOption[],
  startedAt: number,
  userId: string,
): FetchedRoundDetail {
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
      revisions.shots[shot.id] = shotRevision;
      if (disabled_at === null && shotDisabledAt === null) shots.push(shot);
    }
  }
  return {
    roundConfig: {
      name: round.name,
      roundDate: round.round_date,
      format: round.format,
      bowType: round.bow_type,
    },
    status: round.status,
    distances,
    shots,
    targetFaces: faces,
    revisions,
    startedAt,
    userId,
  };
}

// 存在しない・権限なし・論理削除済みのラウンドは、いずれもroundがnullになり、区別しない。
export async function fetchRoundDetail(
  supabase: SupabaseClient<Database>,
  sessionReader: SessionReader,
  roundId: string,
): Promise<FetchResult<FetchedRoundDetail>> {
  const startedAt = Date.now();
  const result = await fetchContent<Fetched>(
    sessionReader,
    async (session) => {
      const userId = session.userId;
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
        selectTargetFaces(supabase, userId),
      ]);
      const failure = failureOf([round, faces]);
      if (failure) return failure as ResponseLike<Fetched>;
      return {
        data: round.data
          ? {
              round: [round.data as unknown as RoundRow],
              targetFaces: (faces.data ?? []) as unknown as TargetFaceRow[],
              userId,
            }
          : null,
        error: null,
        status: 200,
      };
    },
    { nullIsNotFound: true },
  );
  if (result.status !== "ok") return result;

  const { userId } = result.data;
  const faces = sortedTargetFaces(result.data.targetFaces);
  // 確定済みのラウンドの表示は代わりを持たないが、的の保存済みを最新にする機会として使う。
  saveReferenceSnapshot("target-faces", userId, faces, startedAt);
  return {
    status: "ok",
    data: toRoundDetail(result.data.round[0], faces, startedAt, userId),
  };
}

// 1回の取得に並べるラウンドIDの上限。IDはGETのURLに載るため、ゲートウェイが長いURLを414で拒まない件数に分ける。50件で約3KBで、ローカルで通ることを確かめた長さ(約3.7KB)に収まる。
const roundIdsPerRequest = 50;

function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += roundIdsPerRequest) {
    chunks.push(ids.slice(i, i + roundIdsPerRequest));
  }
  return chunks;
}

// 最初の取得は入力中のラウンドを含め、以降は入力中を除く(最初の取得で全件を得るため)。
function selectRoundsChunk(
  supabase: SupabaseClient<Database>,
  chunk: readonly string[],
  index: number,
) {
  const base = supabase
    .from("rounds")
    .select(ROUND_SELECT)
    .is("disabled_at", null)
    .order("position_key", { referencedTable: "distances" })
    .order("id", { referencedTable: "distances" });
  if (index > 0)
    return base
      .neq("status", "in_progress")
      .in("id", [...chunk])
      .retry(false);
  const filter = ["status.eq.in_progress"];
  if (chunk.length > 0) filter.push(`id.in.(${chunk.join(",")})`);
  return base.or(filter.join(",")).retry(false);
}

// 取得の間に状態が変わって同じIDが重なったときは、revisionが大きい行を使い、同じなら先の行を使う。
function mergeRounds(rows: readonly RoundRowWithId[]): RoundRowWithId[] {
  const merged = new Map<string, RoundRowWithId>();
  for (const row of rows) {
    const current = merged.get(row.id);
    if (!current || row.revision > current.revision) merged.set(row.id, row);
  }
  return [...merged.values()];
}

// 入力中のラウンドと、`roundIds`のラウンドを、IDを`roundIdsPerRequest`件ごとの取得に分けて並行に得て、的とともに返す。端末の保持のための取得で、結果は表示に使わない。
// どれかの取得が失敗したら全体を失敗にする(一部の結果を反映すると、返らなかった保持のラウンドが削除の印になるため)。
export async function fetchRoundDetails(
  supabase: SupabaseClient<Database>,
  sessionReader: SessionReader,
  roundIds: readonly string[],
): Promise<FetchResult<FetchedRoundDetails>> {
  const startedAt = Date.now();
  // IDはフィルタの文字列に埋め込むため、UUIDの形だけを通す。
  const ids = roundIds.filter((id) => UUID_PATTERN.test(id));
  const chunks = ids.length > 0 ? chunkIds(ids) : [[]];
  const result = await fetchContent<Fetched>(sessionReader, async (session) => {
    const userId = session.userId;
    const [faces, ...responses] = await Promise.all([
      selectTargetFaces(supabase, userId),
      ...chunks.map((chunk, index) =>
        selectRoundsChunk(supabase, chunk, index),
      ),
    ]);
    const failure = failureOf([...responses, faces]);
    if (failure) return failure as ResponseLike<Fetched>;
    const rows = responses.flatMap(
      (r) => (r.data ?? []) as unknown as RoundRowWithId[],
    );
    return {
      data: {
        round: mergeRounds(rows),
        targetFaces: (faces.data ?? []) as unknown as TargetFaceRow[],
        userId,
      },
      error: null,
      status: 200,
    };
  });
  if (result.status !== "ok") return result;

  const { userId } = result.data;
  const faces = sortedTargetFaces(result.data.targetFaces);
  saveReferenceSnapshot("target-faces", userId, faces, startedAt);
  const rounds = new Map<string, FetchedRoundDetail>();
  for (const round of result.data.round as RoundRowWithId[]) {
    rounds.set(round.id, toRoundDetail(round, faces, startedAt, userId));
  }
  return { status: "ok", data: { rounds, startedAt, userId } };
}

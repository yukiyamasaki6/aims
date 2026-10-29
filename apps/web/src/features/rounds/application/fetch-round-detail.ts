import type { Clock } from "@/lib/clock/contract/clock";
import type { ResponseLike } from "../domain/fetch-result";
import {
  type FetchResult,
  waitLimitMs,
  withFallback,
} from "../domain/fetch-result";
import type { RoundRevisions } from "../domain/round-base";
import type { RoundConfig } from "../domain/round-config";
import { fromServerRound, type ServerRound } from "../domain/round-tables";
import type { Distance, Shot } from "../domain/scorecard-types";
import type { RoundStatus } from "../domain/sync-events";
import {
  orderTargetFaces,
  type TargetFaceOption,
  type TargetFaceRecord,
} from "../domain/target-face-types";
import type { ContentFetcher } from "./fetch-content";

// 参照データ(的)の端末への保存。例外: 投げない。
export type ReferenceSnapshots = {
  load<T>(kind: "target-faces"): T | null;
  save<T>(
    kind: "target-faces",
    userId: string,
    data: T,
    startedAt: number,
  ): void;
};

export type RoundDetailData = {
  round: ServerRound;
  targetFaces: TargetFaceRecord[];
};

export type RoundDetailsData = {
  rounds: ServerRound[];
  targetFaces: TargetFaceRecord[];
};

// 取得の問い合わせの約束。応答はドメインの形に写して返す。
export type RoundQueries = {
  // 存在しない・権限なし・論理削除済みのラウンドは、dataがnull。
  roundDetail(
    userId: string,
    roundId: string,
  ): Promise<ResponseLike<RoundDetailData>>;
  // 入力中のラウンドと、`roundIds`のラウンドをまとめて得る。1つでも失敗したら全体を失敗にする。
  roundDetails(
    userId: string,
    roundIds: readonly string[],
  ): Promise<ResponseLike<RoundDetailsData>>;
  targetFaces(userId: string): Promise<ResponseLike<TargetFaceRecord[]>>;
};

type RoundDetail = {
  roundConfig: RoundConfig;
  status: RoundStatus;
  distances: Distance[];
  shots: Shot[];
  targetFaces: TargetFaceOption[];
};

// `startedAt`は取得の開始時刻、`userId`は取得に使ったセッションの利用者。端末へ保存するベースの記録に付ける。
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

function toDetail(
  round: ServerRound,
  faces: TargetFaceOption[],
  startedAt: number,
  userId: string,
): FetchedRoundDetail {
  return { ...fromServerRound(round), targetFaces: faces, startedAt, userId };
}

export type RoundFetching = ReturnType<typeof createRoundFetching>;

// ラウンドの取得の順序。的を保存して返す、遅れた結果を保存だけする、などを行う。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRoundFetching(deps: {
  content: ContentFetcher;
  queries: RoundQueries;
  snapshots: ReferenceSnapshots;
  clock: Clock;
}) {
  const { content, queries, snapshots, clock } = deps;

  // 的の一覧だけを取得する。作成が未確定のラウンドの読み込みが、ラウンドの取得と別に的を得るために使う。
  // 取得できたら最新で端末へ保存して返す。取得できないとき（FALLBACK_WAIT_MS内に終わらないときを含む）は、
  // 保存済みがあればそれを返し、時間切れの後に届いた結果は表示せず保存だけする。
  async function fetchTargetFaces(): Promise<FetchResult<TargetFaceOption[]>> {
    const startedAt = clock.now();
    const saved = snapshots.load<TargetFaceOption[]>("target-faces");
    let queriedUserId: string | undefined;
    const result = await content.fetchContent(
      (session) => {
        queriedUserId = session.userId;
        return queries.targetFaces(session.userId);
      },
      {
        timeoutMs: waitLimitMs(saved !== null),
        onLateResult: (late) => {
          if (late.status === "ok" && queriedUserId) {
            snapshots.save(
              "target-faces",
              queriedUserId,
              orderTargetFaces(late.data),
              startedAt,
            );
          }
        },
      },
    );
    if (result.status !== "ok") return withFallback(result, saved);
    const faces = orderTargetFaces(result.data);
    if (queriedUserId) {
      snapshots.save("target-faces", queriedUserId, faces, startedAt);
    }
    return { status: "ok", data: faces };
  }

  // 存在しない・権限なし・論理削除済みのラウンドは、いずれもnot-foundで、区別しない。
  async function fetchRoundDetail(
    roundId: string,
  ): Promise<FetchResult<FetchedRoundDetail>> {
    const startedAt = clock.now();
    let userId = "";
    const result = await content.fetchContent<RoundDetailData>(
      (session) => {
        userId = session.userId;
        return queries.roundDetail(session.userId, roundId);
      },
      { nullIsNotFound: true },
    );
    if (result.status !== "ok") return result;
    const faces = orderTargetFaces(result.data.targetFaces);
    // 確定済みのラウンドの表示は代わりを持たないが、的の保存済みを最新にする機会として使う。
    snapshots.save("target-faces", userId, faces, startedAt);
    return {
      status: "ok",
      data: toDetail(result.data.round, faces, startedAt, userId),
    };
  }

  // 入力中のラウンドと、`roundIds`のラウンドを、的とともに取得する。端末の保持のための取得で、結果は表示に使わない。
  // どれかの取得が失敗したら全体を失敗にする(一部の結果を反映すると、返らなかった保持のラウンドが削除の印になるため)。
  async function fetchRoundDetails(
    roundIds: readonly string[],
  ): Promise<FetchResult<FetchedRoundDetails>> {
    const startedAt = clock.now();
    let userId = "";
    const result = await content.fetchContent<RoundDetailsData>((session) => {
      userId = session.userId;
      return queries.roundDetails(session.userId, roundIds);
    });
    if (result.status !== "ok") return result;
    const faces = orderTargetFaces(result.data.targetFaces);
    snapshots.save("target-faces", userId, faces, startedAt);
    const rounds = new Map<string, FetchedRoundDetail>();
    for (const round of result.data.rounds) {
      rounds.set(round.id, toDetail(round, faces, startedAt, userId));
    }
    return { status: "ok", data: { rounds, startedAt, userId } };
  }

  return {
    fetchTargetFaces,
    fetchRoundDetail,
    fetchRoundDetails,
    // 端末に保存した的の一覧。無ければnull。
    savedTargetFaces: (): TargetFaceOption[] | null =>
      snapshots.load<TargetFaceOption[]>("target-faces"),
  };
}

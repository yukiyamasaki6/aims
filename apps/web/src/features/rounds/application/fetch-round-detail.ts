import type { Clock } from "@/lib/clock/contract/clock";
import {
  type FetchResult,
  type ResponseLike,
  waitLimitMs,
  withFallback,
} from "../domain/fetch-result";
import { type PresetRecord, type Presets, presetsOf } from "../domain/preset";
import type { RoundRevisions } from "../domain/round-base";
import type { RoundConfig } from "../domain/round-config";
import {
  type RoundListItem,
  roundListItemOf,
  type ServerRoundSummary,
} from "../domain/round-list";
import { fromServerRound, type ServerRound } from "../domain/round-tables";
import type { Distance, Shot } from "../domain/scorecard-types";
import type { RoundStatus } from "../domain/sync-events";
import {
  orderTargetFaces,
  type TargetFaceOption,
  type TargetFaceRecord,
} from "../domain/target-face-types";
import type { ContentFetcher } from "./fetch-content";
import type { ReferenceKind, ReferenceSnapshots } from "./reference-snapshots";

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
  // 個人(owner_idが自分)と公式(owner_idがnull)を1回で得る。
  presets(userId: string): Promise<ResponseLike<PresetRecord[]>>;
  // 削除されていないラウンドを、実施日の新しい順に得る。入力中のラウンドも含む。ページ、絞り込み、並びの条件はここに足す。
  roundsList(): Promise<ResponseLike<ServerRoundSummary[]>>;
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

  // 保存済みを持つ参照データの取得の順序。取得できたら最新で端末へ保存して返す。取得できないとき（FALLBACK_WAIT_MS内に終わらないときを含む）は、
  // 保存済みがあればそれを返し、時間切れの後に届いた結果は表示せず保存だけする。保存は取得に使った利用者のキーへ行う。
  async function fetchReference<R, T>(
    kind: ReferenceKind,
    query: (userId: string) => Promise<ResponseLike<R>>,
    order: (rows: R) => T,
  ): Promise<FetchResult<T>> {
    const startedAt = clock.now();
    const saved = snapshots.load<T>(kind);
    let queriedUserId: string | undefined;
    const result = await content.fetchContent(
      (session) => {
        queriedUserId = session.userId;
        return query(session.userId);
      },
      {
        timeoutMs: waitLimitMs(saved !== null),
        onLateResult: (late) => {
          if (late.status === "ok" && queriedUserId) {
            snapshots.save(kind, queriedUserId, order(late.data), startedAt);
          }
        },
      },
    );
    if (result.status !== "ok") return withFallback(result, saved);
    const data = order(result.data);
    if (queriedUserId) {
      snapshots.save(kind, queriedUserId, data, startedAt);
    }
    return { status: "ok", data };
  }

  // 的の一覧だけを取得する。作成が未確定のラウンドの読み込みが、ラウンドの取得と別に的を得るために使う。
  function fetchTargetFaces(): Promise<FetchResult<TargetFaceOption[]>> {
    return fetchReference(
      "target-faces",
      queries.targetFaces,
      orderTargetFaces,
    );
  }

  // プリセット（個人と公式）を取得する。取得できたら保存して返す。取得できないときは保存済みを返し、時間切れの後に届いた結果は保存だけする。
  function fetchPresets(): Promise<FetchResult<Presets>> {
    return fetchReference("presets", queries.presets, presetsOf);
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

  // 一覧のラウンドを取得する。代わりは持たない。
  async function fetchRoundsList(): Promise<FetchResult<RoundListItem[]>> {
    const result = await content.fetchContent(() => queries.roundsList());
    if (result.status !== "ok") return result;
    return {
      status: "ok",
      data: (result.data ?? []).map(roundListItemOf),
    };
  }

  return {
    fetchTargetFaces,
    fetchPresets,
    fetchRoundsList,
    fetchRoundDetail,
    fetchRoundDetails,
    // 端末に保存した的の一覧。無ければnull。
    savedTargetFaces: (): TargetFaceOption[] | null =>
      snapshots.load<TargetFaceOption[]>("target-faces"),
  };
}

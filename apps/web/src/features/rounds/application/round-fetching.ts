import type { Clock } from "@/lib/clock/contract/clock";
import type { FetchResult } from "../domain/fetch-status";
import { type PresetRecord, type Presets, presetsOf } from "../domain/preset";
import type { QueryOutcome } from "../domain/query-outcome";
import type { RoundBaseRecord } from "../domain/round-base";
import {
  type RoundListItem,
  roundListItemOf,
  type ServerRoundSummary,
} from "../domain/round-list";
import { baseOfServerRound, type ServerRound } from "../domain/round-tables";
import {
  orderTargetFaces,
  type TargetFaceOption,
  type TargetFaceRecord,
} from "../domain/target-face";
import type { ContentFetcher } from "./content-fetcher";
import type { ReferenceSnapshots } from "./reference-snapshots";

export type RoundDetailsData = {
  rounds: ServerRound[];
  targetFaces: TargetFaceRecord[];
};

// 取得の問い合わせの約束。応答はドメインの形に写して返す。
export type RoundQueries = {
  // 存在しない・権限なし・論理削除済みのラウンドは、not-found。
  roundDetail(roundId: string): Promise<QueryOutcome<ServerRound>>;
  // 入力中のラウンドと、`roundIds`のラウンドをまとめて得る。1つでも失敗したら全体を失敗にする。
  roundDetails(
    userId: string,
    roundIds: readonly string[],
  ): Promise<QueryOutcome<RoundDetailsData>>;
  // 的の一覧。個人(owner_idが自分)と公式(owner_idがnull)を1回で得る。
  targetFaces(userId: string): Promise<QueryOutcome<TargetFaceRecord[]>>;
  // 個人(owner_idが自分)と公式(owner_idがnull)を1回で得る。
  presets(userId: string): Promise<QueryOutcome<PresetRecord[]>>;
  // 削除されていないラウンドを、実施日の新しい順に得る。入力中のラウンドも含む。ページ、絞り込み、並びの条件はここに足す。
  roundsList(): Promise<QueryOutcome<ServerRoundSummary[]>>;
};

// `startedAt`は取得の開始時刻、`userId`は取得に使ったセッションの利用者。端末へ保存するベースの記録に付ける。
export type FetchedRoundDetail = {
  base: RoundBaseRecord;
  startedAt: number;
  userId: string;
};

// 1つのラウンドの取得の結果。not-foundにも、取得の開始時刻と利用者を付ける。
export type RoundDetailResult =
  | Exclude<FetchResult<FetchedRoundDetail>, { status: "not-found" }>
  | { status: "not-found"; startedAt: number; userId: string };

// 複数のラウンドの取得。`rounds`は返ったラウンドだけ(削除済みや権限のないラウンドは含まない)。
export type FetchedRoundDetails = {
  rounds: Map<string, FetchedRoundDetail>;
  startedAt: number;
  userId: string;
};

function toDetail(
  round: ServerRound,
  startedAt: number,
  userId: string,
): FetchedRoundDetail {
  return { base: baseOfServerRound(round), startedAt, userId };
}

export type RoundFetching = ReturnType<typeof createRoundFetching>;

// ラウンドの取得の順序。的とプリセットを保存して返す、などを行う。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 取得ごとの手続きを依存(取得、問い合わせ、保存、時計)とともに閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると依存を引数で渡し回すことになり、責務は分かれず追いにくくなる。
export function createRoundFetching(deps: {
  content: ContentFetcher;
  queries: RoundQueries;
  snapshots: ReferenceSnapshots;
  clock: Clock;
}) {
  const { content, queries, snapshots, clock } = deps;

  // プリセット（個人と公式）を取得する。取得できたら取得に使った利用者のキーへ最新で保存して返す。取得できないときは取得の結果をそのまま返す(保存済みは画面が先に見せる)。
  async function fetchPresets(): Promise<FetchResult<Presets>> {
    const startedAt = clock.now();
    let queriedUserId = "";
    const result = await content.fetchContent((session) => {
      queriedUserId = session.userId;
      return queries.presets(session.userId);
    });
    if (result.status !== "ok") return result;
    const data = presetsOf(result.data);
    snapshots.save("presets", queriedUserId, data, startedAt);
    return { status: "ok", data };
  }

  // 存在しない・権限なし・論理削除済みのラウンドは、いずれもnot-foundで、区別しない。
  // not-foundにも取得の開始時刻と利用者を付ける(端末の保存を消す反映に使う)。
  async function fetchRoundDetail(roundId: string): Promise<RoundDetailResult> {
    const startedAt = clock.now();
    let userId = "";
    const result = await content.fetchContent((session) => {
      userId = session.userId;
      return queries.roundDetail(roundId);
    });
    if (result.status === "not-found") {
      return { status: "not-found", startedAt, userId };
    }
    if (result.status !== "ok") return result;
    return { status: "ok", data: toDetail(result.data, startedAt, userId) };
  }

  // 的の一覧を取得して端末へ保存する。ラウンドの取得とは独立で、画面が的を待つときに使う。
  async function fetchTargetFaces(): Promise<FetchResult<TargetFaceOption[]>> {
    const startedAt = clock.now();
    let userId = "";
    const result = await content.fetchContent((session) => {
      userId = session.userId;
      return queries.targetFaces(session.userId);
    });
    if (result.status !== "ok") return result;
    const faces = orderTargetFaces(result.data);
    snapshots.save("target-faces", userId, faces, startedAt);
    return { status: "ok", data: faces };
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
      rounds.set(round.id, toDetail(round, startedAt, userId));
    }
    return { status: "ok", data: { rounds, startedAt, userId } };
  }

  // 一覧のラウンドを取得する。
  async function fetchRoundsList(): Promise<FetchResult<RoundListItem[]>> {
    const result = await content.fetchContent(() => queries.roundsList());
    if (result.status !== "ok") return result;
    return {
      status: "ok",
      data: result.data.map(roundListItemOf),
    };
  }

  return {
    fetchPresets,
    fetchRoundsList,
    fetchRoundDetail,
    fetchRoundDetails,
    fetchTargetFaces,
    // 端末に保存した的の一覧。無ければnull。
    savedTargetFaces: (): TargetFaceOption[] | null =>
      snapshots.load<TargetFaceOption[]>("target-faces"),
    // 端末に保存したプリセット。無ければnull。
    savedPresets: (): Presets | null => snapshots.load<Presets>("presets"),
  };
}

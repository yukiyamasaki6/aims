import { FETCH_ERROR_MESSAGE, type FetchResult } from "../domain/fetch-status";
import { isRetainedForRefresh } from "../domain/round-retention";
import { roundTablesFromServer } from "../domain/round-tables";
import {
  hasRoundDeletion,
  roundIdOfStream,
  roundStreamId,
} from "../domain/sync-events";
import type { RefreshRequests } from "./refresh-requests";
import type {
  FetchedRoundDetail,
  FetchedRoundDetails,
  RoundFetching,
} from "./round-fetching";
import type { RoundRecordHub } from "./round-record-hub";

function baseOf(detail: FetchedRoundDetail) {
  const { roundConfig, status, distances, shots, revisions } = detail;
  return {
    tables: roundTablesFromServer({ roundConfig, status, distances, shots }),
    revisions,
  };
}

// 取得の結果を端末の記録へ反映する。返ったラウンドはベースにし、返らなかった保持のラウンドは削除の印にする。
// 全ての反映を待って解決する。利用者の照合は記録のハブが行う(取得の利用者と違えば、端末へ保存しない)。
async function commitRoundDetails(
  hub: Pick<RoundRecordHub, "commit">,
  fetched: FetchedRoundDetails,
  retained: readonly string[],
): Promise<void> {
  const { rounds, startedAt, userId } = fetched;
  const commits: Promise<unknown>[] = [];
  for (const [roundId, detail] of rounds) {
    commits.push(
      hub.commit(
        roundStreamId(roundId),
        baseOf(detail),
        detail.startedAt,
        detail.userId,
      ),
    );
  }
  for (const roundId of retained) {
    if (!rounds.has(roundId)) {
      commits.push(hub.commit(roundStreamId(roundId), null, startedAt, userId));
    }
  }
  await Promise.all(commits);
}

// 端末が保持するラウンドのID(削除されておらず作成が確定しているもの)。失敗時は空。
async function retainedRoundIds(
  hub: Pick<RoundRecordHub, "readStored">,
): Promise<string[]> {
  try {
    const stored = await hub.readStored();
    const ids: string[] = [];
    for (const [streamId, group] of stored) {
      const roundId = roundIdOfStream(streamId);
      if (roundId !== null && isRetainedForRefresh(group)) ids.push(roundId);
    }
    return ids;
  } catch {
    return [];
  }
}

export type RoundBaseRefreshResult = "ok" | "gone" | "failed";

// ベースの取得と反映。公開する突き合わせの操作(`round-reconciliation.ts`)から呼ばれる。
export function createRoundBaseRefreshing(deps: {
  hub: Pick<RoundRecordHub, "commit" | "readStored" | "clearDiverged">;
  fetching: Pick<RoundFetching, "fetchRoundDetail" | "fetchRoundDetails">;
  requests: Pick<
    RefreshRequests,
    "beginAll" | "beginRound" | "settleAll" | "settleRound" | "whenListAllows"
  >;
}) {
  const { hub, fetching, requests } = deps;

  // 入力中のラウンドと、端末が保持するラウンドを、まとめて取得して端末の記録へ反映する。
  // `waitForList`が真なら、一覧の依頼を実行に取り込み、一覧の取得が成功したときだけ反映して、依頼を解決する。
  // 偽のときは、一覧の依頼に触れない(実行に取り込まず、解決もしない)。`committed`は、反映したか。
  async function refreshAll(options: {
    waitForList: boolean;
  }): Promise<{ result: FetchResult<null>; committed: boolean }> {
    const run = options.waitForList ? requests.beginAll() : null;
    let outcome: { result: FetchResult<null>; committed: boolean };
    try {
      const retained = await retainedRoundIds(hub);
      const fetched = await fetching.fetchRoundDetails(retained);
      if (fetched.status !== "ok") {
        outcome = { result: fetched, committed: false };
      } else if (run !== null && !(await requests.whenListAllows(run))) {
        outcome = { result: { status: "ok", data: null }, committed: false };
      } else {
        await commitRoundDetails(hub, fetched.data, retained);
        outcome = { result: { status: "ok", data: null }, committed: true };
      }
    } catch {
      outcome = {
        result: { status: "error", message: FETCH_ERROR_MESSAGE },
        committed: false,
      };
    }
    if (run !== null) requests.settleAll(run, outcome.result);
    return outcome;
  }

  // 開いた詳細のラウンドを取得して端末の記録へ反映し、依頼を待つ側へ結果を返す。
  async function refreshRound(id: string): Promise<RoundBaseRefreshResult> {
    const run = requests.beginRound(id);
    hub.clearDiverged(roundStreamId(id));
    let fetched: FetchResult<FetchedRoundDetail>;
    try {
      fetched = await fetching.fetchRoundDetail(id);
    } catch {
      fetched = { status: "error", message: FETCH_ERROR_MESSAGE };
    }
    if (fetched.status !== "ok") {
      requests.settleRound(run, fetched);
      return fetched.status === "not-found" ? "gone" : "failed";
    }
    const base = baseOf(fetched.data);
    let deleted = false;
    try {
      const group = await hub.commit(
        roundStreamId(id),
        base,
        fetched.data.startedAt,
        fetched.data.userId,
      );
      // 取得の間に追記された削除も、取得した状態を表示せずに離れる。
      deleted = hasRoundDeletion(group.entries.map((entry) => entry.operation));
    } catch {
      requests.settleRound(run, {
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
      return "failed";
    }
    requests.settleRound(run, {
      status: "ok",
      data: {
        deleted,
        base: base.tables,
        targetFaces: fetched.data.targetFaces,
      },
    });
    return deleted ? "gone" : "ok";
  }

  return { refreshAll, refreshRound };
}

export type RoundBaseRefreshing = ReturnType<typeof createRoundBaseRefreshing>;

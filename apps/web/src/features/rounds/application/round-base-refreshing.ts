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

// 端末が保持するラウンドのID(削除されておらず作成が確定しているもの)。保存を読めないときは投げる。
async function retainedRoundIds(
  hub: Pick<RoundRecordHub, "readStored">,
): Promise<string[]> {
  const stored = await hub.readStored();
  const ids: string[] = [];
  for (const [streamId, group] of stored) {
    if (isRetainedForRefresh(group)) ids.push(roundIdOfStream(streamId));
  }
  return ids;
}

// ベースの取得と反映。取り直しの制御(`round-refresh-control.ts`)から呼ばれる。
export function createRoundBaseRefreshing(deps: {
  hub: Pick<RoundRecordHub, "commit" | "readStored" | "clearDiverged">;
  fetching: Pick<RoundFetching, "fetchRoundDetail" | "fetchRoundDetails">;
  requests: Pick<RefreshRequests, "beginRound" | "settleRound">;
}) {
  const { hub, fetching, requests } = deps;

  // 入力中のラウンドと、端末が保持するラウンドを、まとめて取得して端末の記録へ反映する。
  // 取得や反映に失敗しても何もしない(次の契機で取り直す)。
  async function refreshAll(): Promise<void> {
    try {
      const retained = await retainedRoundIds(hub);
      const fetched = await fetching.fetchRoundDetails(retained);
      if (fetched.status === "ok") {
        await commitRoundDetails(hub, fetched.data, retained);
      }
    } catch {
      // 失敗は何もしない。
    }
  }

  // 開いた詳細のラウンドを取得して端末の記録へ反映し、依頼を待つ側へ結果を返す。
  // 取得(`fetchRoundDetail`)は例外を値にし、反映(`hub.commit`)は保存の失敗を握って拒否しないため、投げない。
  async function refreshRound(id: string): Promise<void> {
    const run = requests.beginRound(id);
    hub.clearDiverged(roundStreamId(id));
    const fetched = await fetching.fetchRoundDetail(id);
    if (fetched.status !== "ok") {
      requests.settleRound(run, fetched);
      return;
    }
    const base = baseOf(fetched.data);
    const group = await hub.commit(
      roundStreamId(id),
      base,
      fetched.data.startedAt,
      fetched.data.userId,
    );
    // 取得の間に追記された削除も、取得した状態を表示せずに離れる。
    const deleted = hasRoundDeletion(
      group.entries.map((entry) => entry.operation),
    );
    requests.settleRound(run, {
      status: "ok",
      data: {
        deleted,
        base: base.tables,
        targetFaces: fetched.data.targetFaces,
      },
    });
  }

  return { refreshAll, refreshRound };
}

export type RoundBaseRefreshing = ReturnType<typeof createRoundBaseRefreshing>;

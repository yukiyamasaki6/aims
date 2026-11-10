import { isUnknownToServer } from "../domain/round-opening";
import { isRetainedForRefresh } from "../domain/round-retention";
import { roundIdOfStream, roundStreamId } from "../domain/sync-events";
import type { RefreshRequests } from "./refresh-requests";
import type { FetchedRoundDetails, RoundFetching } from "./round-fetching";
import type { RoundRecordHub } from "./round-record-hub";

// 取得の結果を端末の記録へ反映する。返ったラウンドはベースにし、返らなかった保持のラウンドは保存を消して記録を削除済みにする。
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
        detail.base,
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
  hub: Pick<
    RoundRecordHub,
    "commit" | "readStored" | "clearDiverged" | "record"
  >;
  fetching: Pick<RoundFetching, "fetchRoundDetail" | "fetchRoundDetails">;
  requests: Pick<RefreshRequests, "beginRound" | "settleRound" | "facesSaved">;
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
        // 的は取得の中で端末へ保存済み。的の保存を待つ画面へ知らせる。
        requests.facesSaved();
      }
    } catch {
      // 失敗は何もしない。
    }
  }

  // 開いた詳細のラウンドを取得して端末の記録へ反映し、依頼を待つ側へ結果を返す。
  // 取得(`fetchRoundDetail`)の失敗は値で返るため、取得の失敗では投げない。
  // 見つからないときは、サーバーに無いのでなければ(未確定の作成だけが起点でなければ)、保存を消して記録を削除済みにする。
  async function refreshRound(id: string): Promise<void> {
    const run = requests.beginRound(id);
    const streamId = roundStreamId(id);
    hub.clearDiverged(streamId);
    // 取得の開始時点の記録で求める(取得中に作成が確定しても、削除と扱わない)。
    const unknown = isUnknownToServer(hub.record(streamId));
    const fetched = await fetching.fetchRoundDetail(id);
    if (fetched.status === "not-found" && !unknown) {
      await hub.commit(streamId, null, fetched.startedAt, fetched.userId);
    }
    if (fetched.status !== "ok") {
      requests.settleRound(
        run,
        fetched.status === "not-found" ? { status: "not-found" } : fetched,
      );
      return;
    }
    await hub.commit(
      streamId,
      fetched.data.base,
      fetched.data.startedAt,
      fetched.data.userId,
    );
    requests.settleRound(run, {
      status: "ok",
      data: { base: fetched.data.base.tables },
    });
  }

  return { refreshAll, refreshRound };
}

export type RoundBaseRefreshing = ReturnType<typeof createRoundBaseRefreshing>;

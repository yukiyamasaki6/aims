import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { FetchResult } from "../domain/fetch-status";
import type { HistoryCondition } from "../domain/history-view-state";
import {
  deletedRoundIdsOf,
  type LoadedRoundsList,
  snapshotsByRoundId,
} from "../domain/round-list";
import type { RoundFetching } from "./round-fetching";
import type { RoundRecordHub } from "./round-record-hub";
import { withinFetchTimeout } from "./time-limit";

export type RoundsListStore = {
  // 履歴の1ページ。条件と続きの起点(先頭のページはnull)と件数で取得した結果に、端末の列で削除済みのラウンドのIDを添えて返す。1ページごとにFETCH_TIMEOUT_MSで打ち切る。拒否することがある。画面の取得の hook が error にする。
  loadList(
    condition: HistoryCondition,
    after: string | null,
    size: number,
  ): Promise<FetchResult<LoadedRoundsList>>;
  // 取得せずに、端末の列で削除済みのラウンドのIDだけを返す。戻ったときの表示に使う。
  readDeleted(): Promise<Set<string>>;
};

type Deps = {
  hub: Pick<RoundRecordHub, "readList">;
  fetching: Pick<RoundFetching, "fetchRoundsList">;
  clock: Clock;
  connectivity: Connectivity;
};

async function deletedIds(deps: Deps): Promise<Set<string>> {
  return deletedRoundIdsOf(snapshotsByRoundId(await deps.hub.readList()));
}

async function listDetail(
  deps: Deps,
  condition: HistoryCondition,
  after: string | null,
  size: number,
): Promise<FetchResult<LoadedRoundsList>> {
  const deleted = await deletedIds(deps);
  const page = await deps.fetching.fetchRoundsList(condition, after, size);
  if (page.status !== "ok") return page;
  return { status: "ok", data: { ...page.data, deleted } };
}

// 一覧の画面へ渡す、状態と変更の方法。
export function createRoundsListStore(deps: Deps): RoundsListStore {
  const { clock, connectivity } = deps;
  return {
    loadList: (condition, after, size) =>
      withinFetchTimeout(
        clock,
        connectivity,
        listDetail(deps, condition, after, size),
      ),
    readDeleted: () => deletedIds(deps),
  };
}

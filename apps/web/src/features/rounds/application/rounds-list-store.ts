import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { FetchResult } from "../domain/fetch-status";
import {
  deletedRoundIdsOf,
  type LoadedRoundsList,
  snapshotsByRoundId,
} from "../domain/round-list";
import type { RoundFetching } from "./round-fetching";
import type { RoundRecordHub } from "./round-record-hub";
import { withinFetchTimeout } from "./time-limit";

export type RoundsListStore = {
  // 一覧の材料。一覧の取得の結果に、端末の列で削除済みのラウンドのIDを添えて返す。FETCH_TIMEOUT_MSで打ち切る。拒否することがある。画面の取得の hook が error にする。
  loadList(): Promise<FetchResult<LoadedRoundsList>>;
};

type Deps = {
  hub: Pick<RoundRecordHub, "readList">;
  fetching: Pick<RoundFetching, "fetchRoundsList">;
  clock: Clock;
  connectivity: Connectivity;
};

async function listDetail(deps: Deps): Promise<FetchResult<LoadedRoundsList>> {
  const deleted = deletedRoundIdsOf(
    snapshotsByRoundId(await deps.hub.readList()),
  );
  const list = await deps.fetching.fetchRoundsList();
  if (list.status !== "ok") return list;
  return { status: "ok", data: { items: list.data, deleted } };
}

// 一覧の画面へ渡す、状態と変更の方法。
export function createRoundsListStore(deps: Deps): RoundsListStore {
  const { clock, connectivity } = deps;
  return {
    loadList: () => withinFetchTimeout(clock, connectivity, listDetail(deps)),
  };
}

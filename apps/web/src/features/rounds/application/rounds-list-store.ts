import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { FetchResult } from "../domain/fetch-status";
import { FALLBACK_WAIT_MS } from "../domain/fetch-wait";
import {
  deletionsOf,
  type LoadedRoundsList,
  type LocalRoundsList,
  localRoundsList,
  type RoundListItem,
} from "../domain/round-list";
import { roundIdOfStream, roundStreamId } from "../domain/sync-events";
import type { RoundFetching } from "./round-fetching";
import type { HubSnapshot, RoundRecordHub } from "./round-record-hub";
import { withinFetchTimeout } from "./time-limit";
import { type WhenOnline, whenOnline } from "./when-online";

export type RoundsListStore = {
  // 一覧の材料。一覧の取得の結果に、削除の印を反映して返す。FETCH_TIMEOUT_MSで打ち切る。
  loadList(): Promise<FetchResult<LoadedRoundsList>>;
  // 端末の入力中のラウンドの一覧。
  loadLocalList(): Promise<LocalRoundsList>;
  // 端末の記録が変わるたびにlistenerを呼ぶ。返す関数で解除する。
  subscribe(listener: () => void): () => void;
  // FALLBACK_WAIT_MSの後に1回listenerを呼ぶ。
  afterFallbackWait(listener: () => void): void;
  whenOnline: WhenOnline;
};

type Deps = {
  hub: Pick<RoundRecordHub, "commit" | "readList" | "userId" | "subscribe">;
  fetching: Pick<RoundFetching, "fetchRoundsList" | "savedTargetFaces">;
  clock: Clock;
  connectivity: Connectivity;
};

const ERROR_RESULT = {
  status: "error",
  reason: "failed",
} as const;

async function readSnapshots(hub: Pick<RoundRecordHub, "readList">) {
  const all = await hub.readList();
  // 列のIDをラウンドIDに写す。
  const byRound = new Map<string, HubSnapshot>();
  for (const [streamId, snapshot] of all) {
    byRound.set(roundIdOfStream(streamId), snapshot);
  }
  return byRound;
}

async function localList(
  deps: Pick<Deps, "hub" | "fetching">,
): Promise<LocalRoundsList> {
  const snapshots = await readSnapshots(deps.hub);
  const faces = deps.fetching.savedTargetFaces() ?? [];
  return localRoundsList(snapshots, faces);
}

async function listDetail(deps: Deps): Promise<FetchResult<LoadedRoundsList>> {
  const { hub, clock } = deps;
  const startedAt = clock.now();
  const { deleted, confirmed } = deletionsOf(await readSnapshots(hub));
  // 一覧の取得が例外を投げても、固定のerrorにする。
  const list = await deps.fetching
    .fetchRoundsList()
    .catch((): FetchResult<RoundListItem[]> => ERROR_RESULT);
  if (list.status !== "ok") return list;
  // 取得の前に削除が確定していたラウンドは、削除の印として端末の記録へ反映する。
  await Promise.all(
    confirmed.map((roundId) =>
      hub.commit(roundStreamId(roundId), null, startedAt, hub.userId()),
    ),
  );
  const local = await localList(deps);
  return {
    status: "ok",
    data: {
      items: list.data,
      inProgress: local.inProgress,
      deleted,
    },
  };
}

// 一覧の画面へ渡す、状態と変更の方法。
export function createRoundsListStore(deps: Deps): RoundsListStore {
  const { clock, connectivity } = deps;
  return {
    loadList: () => withinFetchTimeout(clock, connectivity, listDetail(deps)),
    loadLocalList: () => localList(deps),
    subscribe: (listener) => deps.hub.subscribe(() => listener()),
    afterFallbackWait: (listener) => {
      clock.after(FALLBACK_WAIT_MS, listener);
    },
    whenOnline: (listener) => whenOnline(connectivity, listener),
  };
}

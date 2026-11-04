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
import type { RefreshRequests } from "./refresh-requests";
import type { RoundDeletion } from "./round-deletion";
import type { RoundFetching } from "./round-fetching";
import type { HubSnapshot, RoundRecordHub } from "./round-record-hub";
import { withinFetchTimeout } from "./time-limit";
import { type WhenOnline, whenOnline } from "./when-online";

export type RoundsListStore = {
  // 一覧の材料。一覧の取得と一括の取得の依頼を並行に行い、削除の印を反映して返す。FETCH_TIMEOUT_MSで打ち切る。
  loadList(): Promise<FetchResult<LoadedRoundsList>>;
  // 端末の入力中のラウンドの一覧。
  loadLocalList(): Promise<LocalRoundsList>;
  // 削除を積み、画面に残る。保存の試みが終わると解決し、拒否しない。送信の完了は待たない。
  deleteRound(roundId: string): Promise<void>;
  // FALLBACK_WAIT_MSの後に1回listenerを呼ぶ。返す関数で取り消す。
  afterFallbackWait(listener: () => void): () => void;
  whenOnline: WhenOnline;
};

type Deps = {
  hub: Pick<RoundRecordHub, "commit" | "generation" | "readList" | "userId">;
  requests: Pick<RefreshRequests, "requestAll" | "allowCommit">;
  fetching: Pick<RoundFetching, "fetchRoundsList" | "savedTargetFaces">;
  clock: Clock;
  connectivity: Connectivity;
  deletion: RoundDeletion;
};

const ERROR_RESULT = {
  status: "error",
  reason: "failed",
} as const;

async function readSnapshots(hub: Pick<RoundRecordHub, "readList">) {
  try {
    const all = await hub.readList();
    // 列のIDをラウンドIDに写す。ラウンドの列でないものは除く。
    const byRound = new Map<string, HubSnapshot>();
    for (const [streamId, snapshot] of all) {
      const roundId = roundIdOfStream(streamId);
      if (roundId !== null) byRound.set(roundId, snapshot);
    }
    return byRound;
  } catch {
    return new Map<string, HubSnapshot>();
  }
}

async function localList(
  deps: Pick<Deps, "hub" | "fetching">,
): Promise<LocalRoundsList> {
  const snapshots = await readSnapshots(deps.hub);
  const faces = deps.fetching.savedTargetFaces() ?? [];
  return localRoundsList(snapshots, faces);
}

// 一覧の取得と、一括の取得の依頼を並行に行い、両方が成功したときだけ成功とする。
// 一括の取得は、一覧の取得が成功したときだけ反映される(`refreshAll` の契約)。
async function fetchListing(
  deps: Pick<Deps, "requests" | "fetching">,
): Promise<FetchResult<RoundListItem[]>> {
  const { requests, fetching } = deps;
  const request = requests.requestAll();
  const listing = fetching.fetchRoundsList().then(
    (result) => {
      requests.allowCommit(request.id, result.status === "ok");
      return result;
    },
    (): FetchResult<RoundListItem[]> => {
      requests.allowCommit(request.id, false);
      return ERROR_RESULT;
    },
  );
  const [list, all] = await Promise.all([listing, request.result]);
  if (list.status !== "ok") return list;
  if (all.status !== "ok") return all;
  return list;
}

async function listDetail(deps: Deps): Promise<FetchResult<LoadedRoundsList>> {
  const { hub, clock } = deps;
  const startedAt = clock.now();
  const generation = hub.generation();
  const { deleted, confirmed } = deletionsOf(await readSnapshots(hub));
  const list = await fetchListing(deps);
  if (list.status !== "ok") return list;
  // 取得の間に利用者が替わったとき(通常の起動で、記録の利用者がnullから現在の利用者に確定するときを含む)は、取得の前の削除の印を現在の記録へ書かず、削除済みを現在の記録から求め直して、一覧は返す。
  const switched = hub.generation() !== generation;
  // 取得の前に削除が確定していたラウンドは、削除の印として端末の記録へ反映する。
  if (!switched) {
    await Promise.all(
      confirmed.map((roundId) =>
        hub.commit(roundStreamId(roundId), null, startedAt, hub.userId()),
      ),
    );
  }
  const deletedNow = switched
    ? deletionsOf(await readSnapshots(hub)).deleted
    : deleted;
  const local = await localList(deps);
  return {
    status: "ok",
    data: {
      items: list.data,
      inProgress: local.inProgress,
      deleted: deletedNow,
    },
  };
}

// 一覧の画面へ渡す、状態と変更の方法。
export function createRoundsListStore(deps: Deps): RoundsListStore {
  const { clock, connectivity, deletion } = deps;
  return {
    loadList: () => withinFetchTimeout(clock, connectivity, listDetail(deps)),
    loadLocalList: () => localList(deps),
    deleteRound: (roundId) => deletion.deleteRound(roundId),
    afterFallbackWait: (listener) => clock.after(FALLBACK_WAIT_MS, listener),
    whenOnline: (listener) => whenOnline(connectivity, listener),
  };
}

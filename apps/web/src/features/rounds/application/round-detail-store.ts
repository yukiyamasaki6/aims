import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { commFailure, type FetchResult } from "../domain/fetch-status";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import { localOpening, openPlan } from "../domain/round-opening";
import { operationsOf } from "../domain/round-record";
import {
  type RoundTables,
  roundTablesFromCreated,
} from "../domain/round-tables";
import { shotIdAfter } from "../domain/shot-id";
import { roundStreamId } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import type { OpenedRound, RefreshRequests } from "./refresh-requests";
import type { RoundEditing } from "./round-editing";
import type { RoundFetching } from "./round-fetching";
import {
  createRoundHandle,
  type LoadedRound,
  type RoundHandle,
} from "./round-handle";
import type { RoundRecordHub } from "./round-record-hub";
import { withinFetchTimeout } from "./time-limit";
import type { UniqueIds } from "./unique-ids";
import { type WhenOnline, whenOnline } from "./when-online";

export type RoundDetailStore = {
  // 開く材料。FETCH_TIMEOUT_MSで打ち切る。
  load(roundId: string): Promise<FetchResult<LoadedRound>>;
  // 購読と操作の追記を持つ`RoundHandle`。ラウンドごとに1つ。
  round(roundId: string): RoundHandle;
  // そのエンドの既にある矢のIDより後ろに並ぶ、時刻順の矢のIDの払い出し。
  newShotId(endShotIds: readonly string[]): string;
  whenOnline: WhenOnline;
};

type Deps = {
  hub: Pick<
    RoundRecordHub,
    "ready" | keyof Parameters<typeof createRoundHandle>[0]["hub"]
  >;
  requests: Pick<
    RefreshRequests,
    | "open"
    | "wantFaces"
    | keyof Parameters<typeof createRoundHandle>[0]["requests"]
  >;
  fetching: Pick<RoundFetching, "savedTargetFaces">;
  clock: Clock;
  connectivity: Connectivity;
  ids: UniqueIds;
  editing: RoundEditing;
};

// 保存済みの的を待つ。保存済みがあれば直ちに返す。無いとき、オフラインなら直ちにオフラインにし、オンラインなら同期に再取得を促して、保存が現れるのを待つ。
// 待ちは取得の打ち切り(FETCH_TIMEOUT_MS)で終え、印と購読を外す。release()で、待ちを途中でやめて印と購読を外す。
function awaitSavedFaces(
  deps: Pick<Deps, "fetching" | "requests" | "clock" | "connectivity">,
  roundId: string,
): {
  result: Promise<FetchResult<TargetFaceOption[]>>;
  release: () => void;
} {
  const { fetching, requests, clock, connectivity } = deps;
  const saved = fetching.savedTargetFaces();
  if (saved) {
    return {
      result: Promise.resolve({ status: "ok", data: saved }),
      release() {},
    };
  }
  if (connectivity.isOffline()) {
    return { result: Promise.resolve({ status: "offline" }), release() {} };
  }
  const key = `open:${roundId}`;
  requests.wantFaces(key, true);
  const { promise, resolve } =
    Promise.withResolvers<FetchResult<TargetFaceOption[]>>();
  const stop = requests.subscribe(() => {
    const found = fetching.savedTargetFaces();
    if (found) finish({ status: "ok", data: found });
  });
  const cancel = clock.after(FETCH_TIMEOUT_MS, () =>
    finish(commFailure(connectivity.isOffline())),
  );
  function finish(outcome: FetchResult<TargetFaceOption[]>) {
    stop();
    cancel();
    requests.wantFaces(key, false);
    resolve(outcome);
  }
  return { result: promise, release: () => finish({ status: "offline" }) };
}

function localDetail(local: {
  base: RoundTables;
  targetFaces: TargetFaceOption[];
}): FetchResult<LoadedRound> {
  return {
    status: "ok",
    data: {
      base: local.base,
      targetFaces: local.targetFaces,
      pendingCreationEventId: null,
    },
  };
}

async function openDetail(
  deps: Pick<Deps, "hub" | "requests" | "fetching" | "clock" | "connectivity">,
  roundId: string,
): Promise<FetchResult<LoadedRound>> {
  const { hub, requests, fetching } = deps;
  const streamId = roundStreamId(roundId);
  // 判断の材料は、起動時に端末から読み込んだメモリの記録。別タブの書き込みは拾わない。
  await hub.ready();
  const record = hub.record(streamId);
  const first = { base: record.base, operations: operationsOf(record) };
  const plan = openPlan(first);
  if (plan.kind === "deleted") return { status: "not-found" };
  if (plan.kind === "creation") {
    // 保存済みの的があれば取得せずに使い、無いときだけ保存が現れるのを待つ。
    const faces = await awaitSavedFaces(deps, roundId).result;
    if (faces.status !== "ok") return faces;
    return {
      status: "ok",
      data: {
        base: roundTablesFromCreated(plan.operation),
        targetFaces: faces.data,
        pendingCreationEventId: plan.operation.eventId,
      },
    };
  }
  // 最新化を常に要求する(取得は同期が行う)。依頼の結果は拒否しない。
  const server = requests.open(roundId);
  const local = localOpening(first, fetching.savedTargetFaces());
  // 保存済みがあれば、取得の結果を待たずに開く。結果は、端末の記録への反映と依頼の結果の記録で、開いた後の画面に届く。
  if (local) return localDetail(local);
  // 保存が無いときは、取得の完了を待つ。待ちの上限は`load`の打ち切りが決める。
  // 的は取得せず、保存済みを使う。無ければ同期に再取得を促して保存を待つ。ラウンドの取得が失敗したときは、的の待ちに引きずられず直ちに返す。
  const faces = awaitSavedFaces(deps, roundId);
  try {
    const opened = await server;
    if (opened.status !== "ok") return opened;
    const targetFaces = await faces.result;
    if (targetFaces.status !== "ok") return targetFaces;
    return {
      status: "ok",
      data: {
        base: opened.data.base,
        targetFaces: targetFaces.data,
        pendingCreationEventId: null,
      },
    };
  } finally {
    faces.release();
  }
}

// 詳細の画面へ渡す、状態と変更の方法。
export function createRoundDetailStore(deps: Deps): RoundDetailStore {
  const { hub, requests, fetching, clock, connectivity, ids, editing } = deps;
  const handles = new Map<string, RoundHandle>();
  return {
    load: (roundId) =>
      withinFetchTimeout(clock, connectivity, openDetail(deps, roundId)),
    round(roundId) {
      let handle = handles.get(roundId);
      if (!handle) {
        handle = createRoundHandle(
          {
            hub,
            requests,
            editing,
            savedFaces: fetching.savedTargetFaces,
          },
          roundId,
        );
        handles.set(roundId, handle);
      }
      return handle;
    },
    newShotId: (endShotIds) =>
      shotIdAfter(endShotIds, clock.now(), ids.randomBytes(10)),
    whenOnline: (listener) => whenOnline(connectivity, listener),
  };
}

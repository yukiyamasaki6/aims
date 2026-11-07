import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { FetchResult } from "../domain/fetch-status";
import { FALLBACK_WAIT_MS } from "../domain/fetch-wait";
import { localOpening, openPlan } from "../domain/round-opening";
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
import type { RoundRecordHub, RoundStoreGroup } from "./round-record-hub";
import { TIMED_OUT, withinFetchTimeout, withinTime } from "./time-limit";
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
    "adopt" | "read" | keyof Parameters<typeof createRoundHandle>[0]["hub"]
  >;
  requests: Pick<
    RefreshRequests,
    "open" | keyof Parameters<typeof createRoundHandle>[0]["requests"]
  >;
  fetching: Pick<RoundFetching, "fetchTargetFaces" | "savedTargetFaces">;
  clock: Clock;
  connectivity: Connectivity;
  ids: UniqueIds;
  editing: RoundEditing;
};

async function readGroup(
  hub: Pick<RoundRecordHub, "read">,
  streamId: string,
): Promise<RoundStoreGroup> {
  try {
    return await hub.read(streamId);
  } catch {
    return { base: undefined, entries: [] };
  }
}

// 取得で削除済みと分かったラウンドは、見つからないものとして返す。
function toDetail(result: FetchResult<OpenedRound>): FetchResult<LoadedRound> {
  if (result.status !== "ok") return result;
  if (result.data.deleted) return { status: "not-found" };
  return {
    status: "ok",
    data: {
      base: result.data.base,
      targetFaces: result.data.targetFaces,
      pendingCreationEventId: null,
      source: "server",
    },
  };
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
      source: "local",
    },
  };
}

async function openDetail(
  deps: Pick<Deps, "hub" | "requests" | "fetching" | "clock">,
  roundId: string,
): Promise<FetchResult<LoadedRound>> {
  const { hub, requests, fetching, clock } = deps;
  const streamId = roundStreamId(roundId);
  const first = await readGroup(hub, streamId);
  hub.adopt(streamId, first);
  const plan = openPlan(first);
  if (plan.kind === "deleted") return { status: "not-found" };
  if (plan.kind === "creation") {
    const faces = await fetching.fetchTargetFaces();
    if (faces.status !== "ok") return faces;
    return {
      status: "ok",
      data: {
        base: roundTablesFromCreated(plan.operation),
        targetFaces: faces.data,
        pendingCreationEventId: plan.operation.eventId,
        source: "server",
      },
    };
  }
  // 取得はここでは行わず、依頼の結果を待つ。依頼の結果は拒否しない。
  const server = requests.open(roundId).then(toDetail);
  const local = localOpening(first, fetching.savedTargetFaces());
  if (!local) return server;
  const raced = await withinTime(clock, server, FALLBACK_WAIT_MS);
  if (raced === TIMED_OUT) return localDetail(local);
  if (raced.status === "ok" || raced.status === "not-found") return raced;
  return localDetail(local);
}

// 詳細の画面へ渡す、状態と変更の方法。
export function createRoundDetailStore(deps: Deps): RoundDetailStore {
  const { hub, requests, clock, connectivity, ids, editing } = deps;
  const handles = new Map<string, RoundHandle>();
  return {
    load: (roundId) =>
      withinFetchTimeout(clock, connectivity, openDetail(deps, roundId)),
    round(roundId) {
      let handle = handles.get(roundId);
      if (!handle) {
        handle = createRoundHandle({ hub, requests, editing }, roundId);
        handles.set(roundId, handle);
      }
      return handle;
    },
    newShotId: (endShotIds) =>
      shotIdAfter(endShotIds, clock.now(), ids.randomBytes(10)),
    whenOnline: (listener) => whenOnline(connectivity, listener),
  };
}

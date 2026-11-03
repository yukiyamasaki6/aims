import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { FetchResult } from "../domain/fetch-status";
import { FALLBACK_WAIT_MS } from "../domain/fetch-wait";
import type { PresetToSave } from "../domain/preset-save";
import {
  type RoundTables,
  roundTablesFromCreated,
} from "../domain/round-tables";
import { localOpening, openPlan } from "../domain/round-view";
import { shotIdAfter } from "../domain/shot-id";
import { roundStreamId } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import type { PresetSaving, PresetSavingResult } from "./preset-saving";
import type { OpenedRound, RefreshRequests } from "./refresh-requests";
import type { RoundEditing } from "./round-editing";
import type { RoundFetching } from "./round-fetching";
import {
  createRoundHandle,
  type LoadedRound,
  type RoundHandle,
} from "./round-handle";
import type { RoundLeaving } from "./round-leaving";
import type { RoundRecordHub, RoundStoreGroup } from "./round-record-hub";
import { TIMED_OUT, withinFetchTimeout, withinTime } from "./time-limit";
import type { UniqueIds } from "./unique-ids";
import { type WhenOnline, whenOnline } from "./when-online";

// deleted: ラウンドの削除が列にあるため、取得した状態を表示せず一覧へ戻る。
export type LoadedRoundDetail =
  | { deleted: true }
  | ({ deleted: false } & LoadedRound);

export type RoundDetailStore = {
  // 開く材料。FETCH_TIMEOUT_MSで打ち切る。
  load(roundId: string): Promise<FetchResult<LoadedRoundDetail>>;
  // 購読と操作の追記を持つ`RoundHandle`。ラウンドごとに1つ。
  round(roundId: string): RoundHandle;
  // 入力の完了。完了の操作を積み、保存の完了の後に一覧へ進む。送信の完了は待たない。遷移が投げたときは拒否する。
  completeRound(roundId: string): Promise<void>;
  // 詳細の確認の後に呼ぶ削除。round.disabledを積み、保存の完了の後に一覧へ置き換えて移る。送信の完了は待たない。遷移が投げたときは拒否する。
  deleteRoundAndLeave(roundId: string): Promise<void>;
  // 一覧へ置き換えて移る(削除済み、作成が確定せずに消えたとき)。
  leaveRound(): void;
  // 現在の構成のプリセットとしての保存。サインインの確認、書き込み、成功の後の保存済みの再取得を行う。
  savePreset(preset: PresetToSave): Promise<PresetSavingResult>;
  // 新しいID(操作のイベントID、距離のID)の払い出し。
  newId(): string;
  // そのエンドの既にある矢のIDより後ろに並ぶ、時刻順の矢のIDの払い出し。
  newShotId(endShotIds: readonly string[]): string;
  whenOnline: WhenOnline;
};

type Deps = {
  hub: RoundRecordHub;
  requests: RefreshRequests;
  fetching: Pick<RoundFetching, "fetchTargetFaces" | "savedTargetFaces">;
  clock: Clock;
  connectivity: Connectivity;
  ids: UniqueIds;
  leaving: RoundLeaving;
  editing: RoundEditing;
  presetSaving: PresetSaving;
};

async function readGroup(
  hub: RoundRecordHub,
  streamId: string,
): Promise<RoundStoreGroup> {
  try {
    return await hub.read(streamId);
  } catch {
    return { base: undefined, entries: [] };
  }
}

function toDetail(
  result: FetchResult<OpenedRound>,
): FetchResult<LoadedRoundDetail> {
  if (result.status !== "ok") return result;
  if (result.data.deleted) {
    return { status: "ok", data: { deleted: true } };
  }
  return {
    status: "ok",
    data: {
      deleted: false,
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
}): FetchResult<LoadedRoundDetail> {
  return {
    status: "ok",
    data: {
      deleted: false,
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
): Promise<FetchResult<LoadedRoundDetail>> {
  const { hub, requests, fetching, clock } = deps;
  const streamId = roundStreamId(roundId);
  const first = await readGroup(hub, streamId);
  hub.adopt(streamId, first);
  const plan = openPlan(first);
  if (plan.kind === "deleted") {
    return { status: "ok", data: { deleted: true } };
  }
  if (plan.kind === "creation") {
    const faces = await fetching.fetchTargetFaces();
    if (faces.status !== "ok") return faces;
    return {
      status: "ok",
      data: {
        deleted: false,
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
  const { hub, requests, clock, connectivity, ids, leaving, editing } = deps;
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
    completeRound: (roundId) => leaving.completeRound(roundId),
    deleteRoundAndLeave: (roundId) => leaving.deleteRoundAndLeave(roundId),
    leaveRound: () => leaving.leaveRound(),
    savePreset: (preset) => deps.presetSaving.savePreset(preset),
    newId: () => ids.next(),
    newShotId: (endShotIds) =>
      shotIdAfter(endShotIds, clock.now(), ids.randomBytes(10)),
    whenOnline: (listener) => whenOnline(connectivity, listener),
  };
}

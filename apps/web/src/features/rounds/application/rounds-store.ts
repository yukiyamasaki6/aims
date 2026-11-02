import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  FALLBACK_WAIT_MS,
  FETCH_ERROR_MESSAGE,
  type FetchResult,
} from "../domain/fetch-result";
import type { Preset, Presets } from "../domain/preset";
import type { PresetToSave } from "../domain/preset-save";
import {
  deletionsOf,
  type LoadedRoundsList,
  type LocalRoundsList,
  localRoundsList,
  type RoundListItem,
} from "../domain/round-list";
import {
  type RoundTables,
  roundTablesFromCreated,
} from "../domain/round-tables";
import { localOpening, openPlan } from "../domain/round-view";
import { shotIdAfter } from "../domain/shot-id";
import {
  roundIdOfStream,
  roundStreamId,
  type SyncOperation,
} from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import type { DeletePresetResult, PresetDeletion } from "./delete-preset";
import type { RoundDeletion } from "./delete-round";
import type { RoundEditing } from "./edit-round";
import type { RoundFetching } from "./fetch-round-detail";
import type { RoundLeaving } from "./leave-round";
import type { OpenedRound, RefreshRequests } from "./refresh-requests";
import {
  createRoundHandle,
  type LoadedRound,
  type RoundHandle,
} from "./round-handle";
import type {
  HubSnapshot,
  RoundRecordHub,
  RoundStoreGroup,
} from "./round-record-hub";
import type { PresetSaving, SavePresetResult } from "./save-preset";
import type { RoundStart, StartRoundResult } from "./start-round";
import {
  TIMED_OUT,
  withinFetchTimeout as withinFetchTimeoutOf,
  withinTime,
} from "./time-limit";
import type { UniqueIds } from "./unique-ids";
import { type WhenOnline, whenOnline } from "./when-online";

// deleted: ラウンドの削除が列にあるため、取得した状態を表示せず一覧へ戻る。
export type LoadedRoundDetail =
  | { deleted: true }
  | ({ deleted: false } & LoadedRound);

export type RoundsStore = {
  load(roundId: string): Promise<FetchResult<LoadedRoundDetail>>;
  loadList(): Promise<FetchResult<LoadedRoundsList>>;
  loadLocalList(): Promise<LocalRoundsList>;
  round(roundId: string): RoundHandle;
  append(roundId: string, operation: SyncOperation): Promise<void>;
  // 入力の完了。完了の操作を積み、保存の完了の後に一覧へ進む。送信の完了は待たない。遷移が投げたときは拒否する。
  completeRound(roundId: string): Promise<void>;
  // 詳細の確認の後に呼ぶ削除。round.disabledを積み、保存の完了の後に一覧へ置き換えて移る。送信の完了は待たない。遷移が投げたときは拒否する。
  deleteRoundAndLeave(roundId: string): Promise<void>;
  // 一覧へ置き換えて移る(削除済み、作成が確定せずに消えたとき)。
  leaveRound(): void;
  // 現在の構成のプリセットとしての保存。サインインの確認、書き込み、成功の後の保存済みの再取得を行う。
  savePreset(preset: PresetToSave): Promise<SavePresetResult>;
  // 新しいID(操作のイベントID、距離のID)の払い出し。
  newId(): string;
  // そのエンドの既にある矢のIDより後ろに並ぶ、時刻順の矢のIDの払い出し。
  newShotId(endShotIds: readonly string[]): string;
  // 一覧の削除。操作の列へround.disabledを積み、画面に残る。保存の試みが終わると解決し、拒否しない。送信の完了は待たない。詳細は`deleteRoundAndLeave`。
  deleteRound(roundId: string): Promise<void>;
  // 今オンラインなら直ちに、オフラインなら次に通信が戻ったときに、1回だけlistenerを呼ぶ。返す関数で取り消す。表示の読み直しの合図で、取得と反映の時点は決めない。
  whenOnline: WhenOnline;
  // FALLBACK_WAIT_MSの後に1回listenerを呼ぶ。返す関数で取り消す。
  afterFallbackWait(listener: () => void): () => void;
  // プリセットの一覧(個人と公式)。取得できれば保存し、取得できなければ保存済み。
  loadPresets(): Promise<FetchResult<Presets>>;
  // 個人プリセットの削除。成功で保存済みからも除く。`isCurrent`は、結果を受け取る画面がまだあるかを返す。
  deletePreset(
    presetId: string,
    isCurrent: () => boolean,
  ): Promise<DeletePresetResult>;
  // 開始。保存の完了の後に詳細へ進む。送信の完了は待たない。遷移が投げたときは拒否する。
  startRound(
    preset: Preset | null,
    isCurrent: () => boolean,
  ): Promise<StartRoundResult>;
};

const ERROR_RESULT = {
  status: "error",
  message: FETCH_ERROR_MESSAGE,
} as const;

// 画面に渡す、正しい状態と変更の方法。取得と反映の時点はここでは決めず、依頼を記録するだけである。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRoundsStore(deps: {
  hub: RoundRecordHub;
  requests: RefreshRequests;
  fetching: RoundFetching;
  clock: Clock;
  connectivity: Connectivity;
  ids: UniqueIds;
  roundStart: RoundStart;
  presetDeletion: PresetDeletion;
  leaving: RoundLeaving;
  deletion: RoundDeletion;
  editing: RoundEditing;
  presetSaving: PresetSaving;
}): RoundsStore {
  const {
    hub,
    requests,
    fetching,
    clock,
    connectivity,
    ids,
    roundStart,
    presetDeletion,
    leaving,
    deletion,
    editing,
    presetSaving,
  } = deps;
  const handles = new Map<string, RoundHandle>();

  const withinFetchTimeout = <T>(loading: Promise<FetchResult<T>>) =>
    withinFetchTimeoutOf(clock, connectivity, loading);

  async function readGroup(streamId: string): Promise<RoundStoreGroup> {
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

  async function openDetail(
    roundId: string,
  ): Promise<FetchResult<LoadedRoundDetail>> {
    const streamId = roundStreamId(roundId);
    const first = await readGroup(streamId);
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

  async function readSnapshots() {
    try {
      const all = await hub.readAll();
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

  async function localList(): Promise<LocalRoundsList> {
    const snapshots = await readSnapshots();
    const faces = fetching.savedTargetFaces() ?? [];
    return localRoundsList(snapshots, faces);
  }

  // 一覧の材料。一覧の取得と、一括の取得の依頼を並行に行い、両方が成功したときだけ成功とする。
  // 一括の取得は、一覧の取得が成功したときだけ反映される(`refreshAll` の契約)。
  async function listDetail(): Promise<FetchResult<LoadedRoundsList>> {
    const startedAt = clock.now();
    const generation = hub.generation();
    const { deleted, confirmed } = deletionsOf(await readSnapshots());
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
      ? deletionsOf(await readSnapshots()).deleted
      : deleted;
    const local = await localList();
    return {
      status: "ok",
      data: {
        items: list.data,
        inProgress: local.inProgress,
        deleted: deletedNow,
      },
    };
  }

  return {
    load: (roundId) => withinFetchTimeout(openDetail(roundId)),
    loadList: () => withinFetchTimeout(listDetail()),
    loadLocalList: localList,
    round(roundId) {
      let handle = handles.get(roundId);
      if (!handle) {
        handle = createRoundHandle({ hub, requests, editing }, roundId);
        handles.set(roundId, handle);
      }
      return handle;
    },
    append: (roundId, operation) =>
      hub.append(roundStreamId(roundId), operation),
    completeRound: (roundId) => leaving.completeRound(roundId),
    deleteRoundAndLeave: (roundId) => leaving.deleteRoundAndLeave(roundId),
    leaveRound: () => leaving.leaveRound(),
    savePreset: (preset) => presetSaving.savePreset(preset),
    newId: () => ids.next(),
    newShotId: (endShotIds) =>
      shotIdAfter(endShotIds, clock.now(), ids.randomBytes(10)),
    deleteRound: (roundId) => deletion.deleteRound(roundId),
    whenOnline: (listener) => whenOnline(connectivity, listener),
    afterFallbackWait: (listener) => clock.after(FALLBACK_WAIT_MS, listener),
    loadPresets: () => fetching.fetchPresets(),
    deletePreset: (presetId, isCurrent) =>
      presetDeletion.deletePreset(presetId, isCurrent),
    startRound: (preset, isCurrent) => roundStart.startRound(preset, isCurrent),
  };
}

import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  commFailure,
  type FetchResult,
  type FetchView,
} from "../domain/fetch-status";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import type { AppliedOperation } from "../domain/round-op-apply";
import {
  isUnknownToServer,
  type OpeningReady,
  roundOpening,
} from "../domain/round-opening";
import { operationsOf, sameRecordedOperations } from "../domain/round-record";
import type { RoundState } from "../domain/round-tables";
import { roundScreenState } from "../domain/round-view";
import {
  hasRoundDeletion,
  roundStreamId,
  type SyncOperation,
} from "../domain/sync-events";
import {
  hasAllTargetFaces,
  type TargetFaceOption,
} from "../domain/target-face";
import type { RoundBaseRefreshing } from "./round-base-refreshing";
import type { RoundEditing } from "./round-editing";
import type { RoundFetching } from "./round-fetching";
import type { RoundRecordHub } from "./round-record-hub";
import { TIMED_OUT, withinTime } from "./time-limit";
import { whenOnline } from "./when-online";

// 詳細の画面が描く、準備完了の値。
export type RoundScreen = {
  // 記録(ベース+操作)から導いた画面の状態。
  state: RoundState;
  // 画面が使う的(保存済み。足りなければ取得後に差し替わる)。
  targetFaces: TargetFaceOption[];
  // 購読後に最初に準備完了になった時点で、ベースに距離が無かったか(設定ダイアログの初期の開閉)。
  initiallyEmpty: boolean;
};

export type RoundEntryDeps = {
  hub: Pick<RoundRecordHub, "ready" | "record" | "subscribe">;
  fetching: Pick<RoundFetching, "savedTargetFaces" | "fetchTargetFaces">;
  refresh: Pick<RoundBaseRefreshing, "refreshRound">;
  // 準備完了の印。overlayは取り直しが要るか、nullは準備完了でない。
  marks: { set(roundId: string, overlay: boolean | null): void };
  editing: RoundEditing;
  clock: Clock;
  connectivity: Connectivity;
};

export type RoundEntry = {
  view(): FetchView<RoundScreen>;
  retry(): void;
  append(operation: SyncOperation): RoundState;
  // 記録と取得の購読を始める。変化のたびにlistenerを呼ぶ。
  start(listener: () => void): void;
  stop(): void;
};

export const LOADING: FetchView<RoundScreen> = { status: "loading" };

function failed(): FetchResult<never> {
  return { status: "error", reason: "failed" };
}

function sameFailure(a: FetchView<unknown>, b: FetchView<unknown>): boolean {
  if (a.status !== b.status) return false;
  return (
    a.status !== "error" || (b.status === "error" && a.reason === b.reason)
  );
}

type Derivation = {
  base: unknown;
  operations: AppliedOperation[];
  faces: TargetFaceOption[];
  screen: ReturnType<typeof roundScreenState>;
};

// 詳細1つの購読(エントリ)。購読者が0→1で作り、1→0で捨てる。
// 記録を読み、保存済みの的を読み、無ければ個別に取得し、存在を判断し、画面の状態を導く。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。判断の規則は domain の純粋関数(roundOpening)にあり、外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRoundEntry(
  roundId: string,
  deps: RoundEntryDeps,
): RoundEntry {
  const { hub, fetching, refresh, marks, editing, clock, connectivity } = deps;
  const streamId = roundStreamId(roundId);
  let notify: () => void = () => {};
  let stopped = false;
  let view: FetchView<RoundScreen> = LOADING;
  // 記録の読み込み。
  let loaded = false;
  let loadFailure: FetchResult<never> | null = null;
  let loadAttempt = 0;
  let deletedAtStart = false;
  // ラウンドの取得。`fetched`は取得を始めたか(購読の開始、確定、retryで偽に戻す)。
  let fetched = false;
  let roundRun = 0;
  let roundFetch: FetchResult<null> | null = null;
  // 的の取得。`facesRequested`は一回きりの印。
  let facesRequested = false;
  let facesRun = 0;
  let facesFetch: FetchResult<TargetFaceOption[]> | null = null;
  // 導出。
  let faces: TargetFaceOption[] | null = null;
  let derivation: Derivation | null = null;
  let initiallyEmpty: boolean | null = null;
  // 準備完了の間だけ付ける、開いている印と、通信の復帰の見張り。
  let watchingOnline = false;
  let stopOnline: (() => void) | undefined;
  let stopHub: (() => void) | undefined;

  function setView(next: FetchView<RoundScreen>) {
    if (next.status === "ok" && view.status === "ok") {
      const same =
        next.data.state === view.data.state &&
        next.data.targetFaces === view.data.targetFaces &&
        next.data.initiallyEmpty === view.data.initiallyEmpty;
      if (same) return;
    } else if (next.status !== "ok" && sameFailure(next, view)) {
      return;
    }
    view = next;
    notify();
  }

  function startRound() {
    fetched = true;
    roundRun += 1;
    const run = roundRun;
    roundFetch = null;
    const settle = (result: FetchResult<null>) => {
      if (stopped || run !== roundRun) return;
      roundFetch = result;
      evaluate();
    };
    refresh.refreshRound(roundId).then(settle, () => settle(failed()));
  }

  function startFaces() {
    facesRequested = true;
    facesRun += 1;
    const run = facesRun;
    facesFetch = null;
    const settle = (result: FetchResult<TargetFaceOption[]>) => {
      if (stopped || run !== facesRun) return;
      facesFetch = result;
      evaluate();
    };
    fetching.fetchTargetFaces().then(settle, () => settle(failed()));
  }

  // 画面用の操作が変わったときだけ、重ね合わせを作り直す。
  function derive(
    record: ReturnType<typeof hub.record>,
    { origin, savedFaces }: OpeningReady,
  ): Derivation {
    const operations = operationsOf(record);
    faces ??= savedFaces;
    const compute = () =>
      roundScreenState(origin, operations, faces ?? savedFaces);
    const previous = derivation;
    const reuse =
      previous !== null &&
      previous.base === record.base &&
      previous.faces === faces &&
      sameRecordedOperations(previous.operations, operations);
    let screen = reuse ? previous.screen : compute();
    // 距離の参照する的が足りないとき、保存済みが全て含むなら、保存済みに替えて導出し直す。
    if (
      !hasAllTargetFaces(faces, screen.state.distances) &&
      hasAllTargetFaces(savedFaces, screen.state.distances)
    ) {
      faces = savedFaces;
      screen = compute();
    }
    derivation = { base: record.base, operations, faces, screen };
    return derivation;
  }

  // 準備完了の間だけ、取り直しの対象にする印を付ける。
  function syncReadyMarks(ready: Derivation | null) {
    marks.set(roundId, ready ? ready.screen.needsRefetch : null);
  }

  // offlineの間だけ、通信が戻ったら自動で再取得する。errorは自動で再取得しない。
  function syncOnlineWatch() {
    if (view.status !== "offline") {
      stopOnline?.();
      stopOnline = undefined;
      watchingOnline = false;
      return;
    }
    if (watchingOnline) return;
    watchingOnline = true;
    stopOnline = whenOnline(connectivity, () => {
      watchingOnline = false;
      stopOnline = undefined;
      retry();
    });
  }

  // 準備完了なら画面の値を出す。起点が無い、または的が無いときは、判断の結果(取得中、失敗)を出す。
  function present(
    record: ReturnType<typeof hub.record>,
    opening: FetchView<OpeningReady>,
  ): Derivation | null {
    if (opening.status !== "ok") {
      setView(opening);
      return null;
    }
    const ready = derive(record, opening.data);
    // 的が揃ったら、一回きりの印を戻す。足りないままの間は繰り返さない。
    if (hasAllTargetFaces(ready.faces, ready.screen.state.distances)) {
      facesRequested = false;
    } else if (!facesRequested) {
      startFaces();
    }
    initiallyEmpty ??= opening.data.origin.distances.length === 0;
    setView({
      status: "ok",
      data: {
        state: ready.screen.state,
        targetFaces: ready.faces,
        initiallyEmpty,
      },
    });
    return ready;
  }

  function evaluate() {
    if (stopped) return;
    if (!loaded) {
      setView(loadFailure ?? LOADING);
      syncReadyMarks(null);
      syncOnlineWatch();
      return;
    }
    const record = hub.record(streamId);
    const unavailable = deletedAtStart || record.base?.base === null;
    // 取得の規則は1つ。削除済みでなく、取得を始めておらず、サーバーに無いのでなければ、取得を1回始める。
    if (!unavailable && !fetched && !isUnknownToServer(record)) startRound();
    const saved = fetching.savedTargetFaces();
    const opening = roundOpening({
      record: { base: record.base, operations: operationsOf(record) },
      deletedAtStart,
      savedFaces: saved,
      roundFetch,
      facesFetch,
    });
    if (!unavailable && saved === null && !facesRequested) startFaces();
    const ready = present(record, opening);
    syncReadyMarks(ready);
    syncOnlineWatch();
  }

  function waitLoaded() {
    loadAttempt += 1;
    const attempt = loadAttempt;
    const ready = hub.ready();
    void ready.then(() => onLoaded());
    void withinTime(clock, ready, FETCH_TIMEOUT_MS).then((raced) => {
      if (raced !== TIMED_OUT || loaded || stopped || attempt !== loadAttempt) {
        return;
      }
      loadFailure = commFailure(connectivity.isOffline());
      evaluate();
    });
  }

  function onLoaded() {
    if (loaded || stopped) return;
    loaded = true;
    loadFailure = null;
    // 削除の操作の判定は、この最初の1回だけに使う。
    deletedAtStart = hasRoundDeletion(
      operationsOf(hub.record(streamId)).map((entry) => entry.operation),
    );
    evaluate();
  }

  function retry() {
    if (stopped) return;
    fetched = false;
    facesRequested = false;
    roundFetch = null;
    facesFetch = null;
    if (!loaded) {
      loadFailure = null;
      waitLoaded();
    }
    evaluate();
  }

  return {
    view: () => view,
    retry,
    // 準備完了の間だけ。追記は同期で記録の通知から導き直されるため、戻りの時点の導出が追記の結果である。
    append(operation) {
      if (view.status !== "ok" || derivation === null) {
        throw new Error("準備完了でないラウンドへは追記できません。");
      }
      const { tables } = derivation.screen;
      editing.append(roundId, operation, {
        tables,
        targetFaces: derivation.faces,
      });
      return derivation.screen.state;
    },
    start(listener) {
      notify = listener;
      stopHub = hub.subscribe((change) => {
        // 記録の読み込みが終わるまでは、通知で導き直さない(読み込みの途中の記録で判定しないため)。
        if (change.streamId === streamId && loaded) evaluate();
      });
      waitLoaded();
    },
    stop() {
      stopped = true;
      stopHub?.();
      stopOnline?.();
      marks.set(roundId, null);
    },
  };
}

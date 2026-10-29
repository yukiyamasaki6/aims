import { FETCH_ERROR_MESSAGE, type FetchResult } from "../domain/fetch-result";
import type { RoundTables } from "../domain/round-tables";
import type { TargetFaceOption } from "../domain/target-face-types";

// サーバーから取得した、開いた詳細の材料。deletedは、取得の間に削除が追記されたため、取得した状態を表示せず離れる。
export type OpenedRound = {
  deleted: boolean;
  base: RoundTables;
  targetFaces: TargetFaceOption[];
};

// 取り直しの結果の分類。
export type RoundOutcome = "ok" | "gone" | "failed";

type ListRequest = {
  id: number;
  // 一覧の取得の成否。決まるまでnull。
  allowed: boolean | null;
  resolve: (result: FetchResult<null>) => void;
};

// 取り直しの依頼の記録。画面は「開いた」「一覧を開いた」と依頼するだけで、取得と反映の時点は同期が決める。
// 依頼を待つ側へ結果を返すのは`settleRound`、`settleAll`である。
// 取り直しの結果の分類。
function outcomeOfResult(result: FetchResult<OpenedRound>): RoundOutcome {
  if (result.status === "ok") return result.data.deleted ? "gone" : "ok";
  return result.status === "not-found" ? "gone" : "failed";
}

type OpenWaiter = { resolve: (result: FetchResult<OpenedRound>) => void };

// 取り直しの開始時に、その取り直しが答える依頼を控えたもの。
export type RoundRun = {
  roundId: string;
  waiters: OpenWaiter[];
  seq: number;
  // 取り直しを始めた時点の世代。停止で進み、古い取り直しの結果は捨てられる。
  generation: number;
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRefreshRequests() {
  const opens = new Map<string, OpenWaiter[]>();
  // 開く依頼を出すたびに進める。古い取り直しの結果で、新しい依頼の結果の記録を上書きしないため。
  const openSeq = new Map<string, number>();
  const outcomes = new Map<string, RoundOutcome>();
  const watching = new Map<string, { count: number; local: boolean }>();
  // 確定済みの操作をベースに重ねられなかった(取り直しが要る)開いた詳細。
  const overlay = new Set<string>();
  let pendingLists: ListRequest[] = [];
  // 実行ごとに、その実行に含めた一覧の依頼を持つ。許可の判定と完了は、その実行の依頼だけに適用する(停止をまたぐ古い実行が、新しい実行の依頼に触れないため)。
  const runs = new Map<number, ListRequest[]>();
  const live = new Map<number, ListRequest>();
  let nextRun = 1;
  // 停止のたびに進める。停止前に始まった取り直しの完了が、現在の結果・待ち・通知に触れないため。
  let generation = 0;
  let nextId = 1;
  const decisionWaiters = new Set<() => void>();
  const listeners = new Set<() => void>();

  function changed() {
    for (const listener of [...listeners]) listener();
  }

  return {
    // 詳細を開く依頼。同期が取得して結果を返すまで解決しない。
    open(roundId: string): Promise<FetchResult<OpenedRound>> {
      outcomes.delete(roundId);
      openSeq.set(roundId, (openSeq.get(roundId) ?? 0) + 1);
      return new Promise((resolve) => {
        const waiters = opens.get(roundId) ?? [];
        waiters.push({ resolve });
        opens.set(roundId, waiters);
        changed();
      });
    },
    pendingOpens: (): string[] => [...opens.keys()],
    // 取り直しを始める。その時点で記録にある開く依頼だけが、この取り直しの結果を受ける。
    beginRound(roundId: string): RoundRun {
      return {
        roundId,
        waiters: [...(opens.get(roundId) ?? [])],
        seq: openSeq.get(roundId) ?? 0,
        generation,
      };
    },
    // 取り直しの結果を、その取り直しが始まった時点の依頼へ返す。始めた後に出された依頼には返さない。
    settleRound(run: RoundRun, result: FetchResult<OpenedRound>) {
      // 停止をまたいだ古い取り直しの結果は、記録も待ちも通知も変えない。
      if (run.generation !== generation) return;
      const { roundId } = run;
      const outcome = outcomeOfResult(result);
      // 始めた後に新しい依頼が出ているときは、その依頼の結果の記録を上書きしない。
      if ((openSeq.get(roundId) ?? 0) === run.seq)
        outcomes.set(roundId, outcome);
      const remaining = (opens.get(roundId) ?? []).filter(
        (waiter) => !run.waiters.includes(waiter),
      );
      if (remaining.length > 0) opens.set(roundId, remaining);
      else opens.delete(roundId);
      for (const waiter of run.waiters) waiter.resolve(result);
      changed();
    },
    outcomeOf: (roundId: string): RoundOutcome | undefined =>
      outcomes.get(roundId),
    // 開いている間の印。localは、端末のベースで開いたこと(取得できるまで古い)。
    watch(roundId: string, local: boolean): () => void {
      const current = watching.get(roundId);
      watching.set(roundId, {
        count: (current?.count ?? 0) + 1,
        local: current?.local === false ? false : local,
      });
      changed();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const entry = watching.get(roundId);
        if (!entry) return;
        if (entry.count <= 1) watching.delete(roundId);
        else watching.set(roundId, { ...entry, count: entry.count - 1 });
        changed();
      };
    },
    watched(): { roundId: string; local: boolean }[] {
      return [...watching].map(([roundId, entry]) => ({
        roundId,
        local: entry.local,
      }));
    },
    setOverlay(roundId: string, needed: boolean) {
      if (overlay.has(roundId) === needed) return;
      if (needed) overlay.add(roundId);
      else overlay.delete(roundId);
      changed();
    },
    overlayNeeded: (roundId: string): boolean => overlay.has(roundId),
    // 一覧を開いた依頼。一括の取得の結果は、返すPromiseで待つ。
    requestAll(): { id: number; result: Promise<FetchResult<null>> } {
      const id = nextId;
      nextId += 1;
      const result = new Promise<FetchResult<null>>((resolve) => {
        const request: ListRequest = { id, allowed: null, resolve };
        pendingLists.push(request);
        live.set(id, request);
      });
      changed();
      return { id, result };
    },
    // 一覧の取得の成否。成功のときだけ、一括の取得の結果を反映してよい。
    allowCommit(id: number, ok: boolean) {
      const request = live.get(id);
      if (request) request.allowed = ok;
      for (const waiter of [...decisionWaiters]) waiter();
    },
    // 実行を始めた時点で記録にある一覧の依頼を、この実行に含める。実行中に届いた依頼は、次の実行に含める。実行の識別子を返す。
    beginAll(): number {
      const run = nextRun;
      nextRun += 1;
      runs.set(run, pendingLists);
      pendingLists = [];
      changed();
      return run;
    },
    hasListRequests: (): boolean => pendingLists.length > 0,
    // その実行に含まれる一覧の依頼のどれかの一覧の取得が成功なら真、全てが失敗なら偽。含まれる依頼が無ければ待たずに偽。
    whenListAllows(run: number): Promise<boolean> {
      const targets = runs.get(run) ?? [];
      if (targets.length === 0) return Promise.resolve(false);
      return new Promise((resolve) => {
        const check = () => {
          const anyAllowed = targets.some(
            (request) => request.allowed === true,
          );
          const allDecided = targets.every(
            (request) => request.allowed !== null,
          );
          if (!anyAllowed && !allDecided) return;
          decisionWaiters.delete(check);
          resolve(anyAllowed);
        };
        decisionWaiters.add(check);
        check();
      });
    },
    // 一括の取得の結果を、その実行に含まれる依頼へ返す。
    settleAll(run: number, result: FetchResult<null>) {
      const done = runs.get(run) ?? [];
      runs.delete(run);
      for (const request of done) {
        live.delete(request.id);
        request.resolve(result);
      }
      changed();
    },
    // 停止。待っている全ての依頼をエラーで終え、以後、停止前に始まった取り直しの結果は捨てる。
    reset() {
      generation += 1;
      const error: FetchResult<never> = {
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      };
      const waiting = [...opens.values()].flat();
      opens.clear();
      for (const waiter of waiting) waiter.resolve(error);
      const lists = [...pendingLists, ...[...runs.values()].flat()];
      pendingLists = [];
      runs.clear();
      live.clear();
      for (const request of lists) request.resolve(error);
      changed();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: changed,
  };
}

export type RefreshRequests = ReturnType<typeof createRefreshRequests>;

import type { FetchResult } from "../domain/fetch-status";
import {
  beginListRun,
  decideList,
  EMPTY_LIST_REQUESTS,
  type ListRequests,
  type ListRun,
  listVerdict,
  requestList,
  settleListRun,
  stopLists,
} from "../domain/list-requests";
import {
  beginOpenRun,
  EMPTY_OPEN_REQUESTS,
  type OpenRequests,
  type OpenRun,
  type RoundOutcome,
  requestOpen,
  settleOpenRun,
  stopOpens,
} from "../domain/open-requests";
import type { RoundTables } from "../domain/round-tables";
import type { TargetFaceOption } from "../domain/target-face";

// サーバーから取得した、開いた詳細の材料。deletedは、取得の間に削除が追記されたため、取得した状態を表示せず離れる。
export type OpenedRound = {
  deleted: boolean;
  base: RoundTables;
  targetFaces: TargetFaceOption[];
};

// 取り直しの結果の分類。
function outcomeOfResult(result: FetchResult<OpenedRound>): RoundOutcome {
  if (result.status === "ok") return result.data.deleted ? "gone" : "ok";
  return result.status === "not-found" ? "gone" : "failed";
}

const STOPPED: FetchResult<never> = {
  status: "error",
  reason: "failed",
};

// 取り直しの依頼の記録。画面は「開いた」「一覧を開いた」と依頼するだけで、取得と反映の時点はこの記録では決めない。
// 規則は集約(開く依頼 `open-requests.ts`、一覧の依頼 `list-requests.ts`)が持ち、ここは状態を保ち、依頼の番号ごとの結果を渡す先を呼ぶ。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRefreshRequests() {
  let opens: OpenRequests = EMPTY_OPEN_REQUESTS;
  let lists: ListRequests = EMPTY_LIST_REQUESTS;
  // 依頼の番号ごとの、結果を渡す先。
  const openResolvers = new Map<
    string,
    Map<number, (result: FetchResult<OpenedRound>) => void>
  >();
  const listResolvers = new Map<number, (result: FetchResult<null>) => void>();
  const watching = new Map<string, { count: number; local: boolean }>();
  // 確定済みの操作をベースに重ねられなかった(取り直しが要る)開いた詳細。
  const overlay = new Set<string>();
  // 反映の許可の待ち。判定の関数と、待ち(`whenListAllows` の約束)を解決する関数の組で持つ。停止で全て解決する。
  const decisionWaiters = new Map<() => void, (allowed: boolean) => void>();
  const listeners = new Set<() => void>();

  function changed() {
    for (const listener of [...listeners]) listener();
  }

  function resolveOpen(
    roundId: string,
    request: number,
    result: FetchResult<OpenedRound>,
  ) {
    const resolvers = openResolvers.get(roundId);
    const resolve = resolvers?.get(request);
    resolvers?.delete(request);
    resolve?.(result);
  }

  return {
    // 詳細を開く依頼。取り直しの実行が結果を返すまで解決しない。
    open(roundId: string): Promise<FetchResult<OpenedRound>> {
      const next = requestOpen(opens, roundId);
      opens = next.state;
      return new Promise((resolve) => {
        const resolvers = openResolvers.get(roundId) ?? new Map();
        resolvers.set(next.request, resolve);
        openResolvers.set(roundId, resolvers);
        changed();
      });
    },
    // 最後に受けた一覧の依頼の番号。依頼が無ければ0。アプリの寿命の間増え続け、停止でも数え直さない。
    latestListRequest: (): number => lists.latest,
    // そのラウンドの最後の開く依頼の番号。依頼が無ければ0。アプリの寿命の間増え続け、停止でも数え直さない。
    latestOpenRequest: (roundId: string): number =>
      opens.get(roundId)?.latest ?? 0,
    pendingOpens: (): string[] =>
      [...opens]
        .filter(([, round]) => round.waiting.length > 0)
        .map(([roundId]) => roundId),
    // 取り直しを始める。その時点で待っている開く依頼だけが、この取り直しの結果を受ける。結果の記録の権利は、この取り直しへ移る。
    beginRound(roundId: string): OpenRun {
      const next = beginOpenRun(opens, roundId);
      opens = next.state;
      return next.run;
    },
    // 取り直しの結果を、その取り直しが始まった時点の依頼へ返す。記録の権利を持つ取り直しだけが、結果を記録する。
    settleRound(run: OpenRun, result: FetchResult<OpenedRound>) {
      const next = settleOpenRun(opens, run, outcomeOfResult(result));
      opens = next.state;
      for (const request of next.answered) {
        resolveOpen(run.roundId, request, result);
      }
      if (next.changed) changed();
    },
    outcomeOf: (roundId: string): RoundOutcome | undefined =>
      opens.get(roundId)?.outcome,
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
      const next = requestList(lists);
      lists = next.state;
      const result = new Promise<FetchResult<null>>((resolve) => {
        listResolvers.set(next.request, resolve);
      });
      changed();
      return { id: next.request, result };
    },
    // 一覧の取得の成否。成功のときだけ、一括の取得の結果を反映してよい。
    allowCommit(id: number, ok: boolean) {
      lists = decideList(lists, id, ok);
      for (const check of [...decisionWaiters.keys()]) check();
    },
    // 実行を始めた時点で記録にある一覧の依頼を、この実行に含める。実行中に届いた依頼は、次の実行に含める。
    beginAll(): ListRun {
      const next = beginListRun(lists);
      lists = next.state;
      changed();
      return next.run;
    },
    hasListRequests: (): boolean => lists.pending.length > 0,
    // その実行に含まれる一覧の依頼のどれかの一覧の取得が成功なら真、全てが失敗なら偽。含まれる依頼が無ければ待たずに偽。
    whenListAllows(run: ListRun): Promise<boolean> {
      const first = listVerdict(lists, run);
      if (first !== "undecided") return Promise.resolve(first === "allowed");
      return new Promise((resolve) => {
        const check = () => {
          const verdict = listVerdict(lists, run);
          if (verdict === "undecided") return;
          decisionWaiters.delete(check);
          resolve(verdict === "allowed");
        };
        decisionWaiters.set(check, resolve);
      });
    },
    // 一括の取得の結果を、その実行に含まれる依頼へ返す。
    settleAll(run: ListRun, result: FetchResult<null>) {
      const next = settleListRun(lists, run);
      lists = next.state;
      for (const request of next.answered) {
        listResolvers.get(request)?.(result);
        listResolvers.delete(request);
      }
      changed();
    },
    // 停止。待っている全ての依頼をエラーで終え、記録の権利を空にする。以後、停止前に始まった取り直しは、記録も解決もしない。
    reset() {
      const stoppedOpens = stopOpens(opens);
      opens = stoppedOpens.state;
      for (const { roundId, request } of stoppedOpens.answered) {
        resolveOpen(roundId, request, STOPPED);
      }
      const stoppedLists = stopLists(lists);
      lists = stoppedLists.state;
      for (const request of stoppedLists.answered) {
        listResolvers.get(request)?.(STOPPED);
        listResolvers.delete(request);
      }
      // 反映の許可を待つ実行は、反映しないで終える。
      const allowWaiters = [...decisionWaiters.values()];
      decisionWaiters.clear();
      for (const resolve of allowWaiters) resolve(false);
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

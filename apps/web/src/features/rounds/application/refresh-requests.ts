import type { FetchResult } from "../domain/fetch-status";
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

// 取り直しの依頼の記録。画面は「開いた」と依頼するだけで、取得と反映の時点はこの記録では決めない。
// 規則は集約(開く依頼 `open-requests.ts`)が持ち、ここは状態を保ち、依頼の番号ごとの結果を渡す先を呼ぶ。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRefreshRequests() {
  let opens: OpenRequests = EMPTY_OPEN_REQUESTS;
  // 依頼の番号ごとの、結果を渡す先。
  const openResolvers = new Map<
    string,
    Map<number, (result: FetchResult<OpenedRound>) => void>
  >();
  const watching = new Map<string, number>();
  // 確定済みの操作をベースに重ねられなかった(取り直しが要る)開いた詳細。
  const overlay = new Set<string>();
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
    // 開いている間の印。取り直しの要否の判定が、開いている詳細を知るために使う。
    watch(roundId: string): () => void {
      watching.set(roundId, (watching.get(roundId) ?? 0) + 1);
      changed();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = watching.get(roundId);
        if (count === undefined) return;
        if (count <= 1) watching.delete(roundId);
        else watching.set(roundId, count - 1);
        changed();
      };
    },
    watched(): { roundId: string }[] {
      return [...watching.keys()].map((roundId) => ({ roundId }));
    },
    setOverlay(roundId: string, needed: boolean) {
      if (overlay.has(roundId) === needed) return;
      if (needed) overlay.add(roundId);
      else overlay.delete(roundId);
      changed();
    },
    overlayNeeded: (roundId: string): boolean => overlay.has(roundId),
    // 停止。待っている全ての依頼をエラーで終え、記録の権利を空にする。以後、停止前に始まった取り直しは、記録も解決もしない。
    reset() {
      const stoppedOpens = stopOpens(opens);
      opens = stoppedOpens.state;
      for (const { roundId, request } of stoppedOpens.answered) {
        resolveOpen(roundId, request, STOPPED);
      }
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

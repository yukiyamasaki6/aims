import type { FetchResult } from "../domain/fetch-status";
import {
  beginOpenRun,
  EMPTY_OPEN_REQUESTS,
  type OpenRequests,
  type OpenRun,
  requestOpen,
  settleOpenRun,
} from "../domain/open-requests";
import type { RoundTables } from "../domain/round-tables";

// サーバーから取得した、開いた詳細の材料。
export type OpenedRound = {
  base: RoundTables;
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
  const watching = new Set<string>();
  // 確定済みの操作をベースに重ねられなかった(取り直しが要る)開いた詳細。
  const overlay = new Set<string>();
  // 的が足りないことを知らせる印。印を付けた側がキーを決める。
  const facesWanted = new Set<string>();
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
    // そのラウンドの最後の開く依頼の番号。依頼が無ければ0。アプリの寿命の間増え続ける。
    latestOpenRequest: (roundId: string): number =>
      opens.get(roundId)?.latest ?? 0,
    pendingOpens: (): string[] =>
      [...opens]
        .filter(([, round]) => round.waiting.length > 0)
        .map(([roundId]) => roundId),
    // 取り直しを始める。その時点で待っている開く依頼だけが、この取り直しの結果を受ける。
    beginRound: (roundId: string): OpenRun => beginOpenRun(opens, roundId),
    // 取り直しの結果を、その取り直しが始まった時点の依頼へ返す。ラウンドが見つからなかったかは、最後に終わった取り直しの結果になる。
    settleRound(run: OpenRun, result: FetchResult<OpenedRound>) {
      const next = settleOpenRun(opens, run, result.status === "not-found");
      opens = next.state;
      for (const request of next.answered) {
        resolveOpen(run.roundId, request, result);
      }
      if (next.changed) changed();
    },
    isGone: (roundId: string): boolean => opens.get(roundId)?.gone ?? false,
    // 開いている間の印。取り直しの要否の判定が、開いている詳細を知るために使う。
    watch(roundId: string): () => void {
      watching.add(roundId);
      changed();
      return () => {
        watching.delete(roundId);
        changed();
      };
    },
    watched(): { roundId: string }[] {
      return [...watching].map((roundId) => ({ roundId }));
    },
    setOverlay(roundId: string, needed: boolean) {
      if (overlay.has(roundId) === needed) return;
      if (needed) overlay.add(roundId);
      else overlay.delete(roundId);
      changed();
    },
    overlayNeeded: (roundId: string): boolean => overlay.has(roundId),
    // 的が足りないという印を付ける、または外す。変わったときだけ知らせる。
    wantFaces(key: string, wanted: boolean) {
      if (facesWanted.has(key) === wanted) return;
      if (wanted) facesWanted.add(key);
      else facesWanted.delete(key);
      changed();
    },
    facesWanted: (): boolean => facesWanted.size > 0,
    // 的を端末へ保存したことを知らせる。
    facesSaved: changed,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type RefreshRequests = ReturnType<typeof createRefreshRequests>;

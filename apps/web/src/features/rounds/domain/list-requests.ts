// 一覧の依頼の集約。一覧の依頼の番号、一覧の取得の成否、一括の取得の実行に含めた依頼を、変更しない値と関数にしたもの。
// `Promise`と通知を持たない。依頼の番号ごとの結果を渡す先は、手続きが持つ。

// 1回の一括の実行。値の同一性で見分ける。requestsは、実行を始めた時点の一覧の依頼の番号。
export type ListRun = { readonly requests: readonly number[] };

// latestは最後の一覧の依頼の番号(停止でも数え直さない)。decisionsは、解決していない依頼ごとの一覧の取得の成否(決まるまでnull)。
export type ListRequests = {
  readonly latest: number;
  readonly pending: readonly number[];
  readonly decisions: ReadonlyMap<number, boolean | null>;
  readonly runs: ReadonlySet<ListRun>;
};

export const EMPTY_LIST_REQUESTS: ListRequests = {
  latest: 0,
  pending: [],
  decisions: new Map(),
  runs: new Set(),
};

export function requestList(state: ListRequests): {
  state: ListRequests;
  request: number;
} {
  const request = state.latest + 1;
  const decisions = new Map(state.decisions);
  decisions.set(request, null);
  return {
    state: {
      ...state,
      latest: request,
      pending: [...state.pending, request],
      decisions,
    },
    request,
  };
}

// 解決していない依頼だけに成否を書く。それ以外は状態を変えない。
export function decideList(
  state: ListRequests,
  request: number,
  ok: boolean,
): ListRequests {
  if (!state.decisions.has(request)) return state;
  const decisions = new Map(state.decisions);
  decisions.set(request, ok);
  return { ...state, decisions };
}

// 待っている依頼を実行に含める。
export function beginListRun(state: ListRequests): {
  state: ListRequests;
  run: ListRun;
} {
  const run: ListRun = { requests: [...state.pending] };
  return {
    state: { ...state, pending: [], runs: new Set([...state.runs, run]) },
    run,
  };
}

// 含めた依頼のどれかが成功ならallowed、全て失敗ならdenied、それ以外はundecided。
// 生きていない実行と、含めた依頼が無い実行はdenied。
export function listVerdict(
  state: ListRequests,
  run: ListRun,
): "allowed" | "denied" | "undecided" {
  if (!state.runs.has(run) || run.requests.length === 0) return "denied";
  if (run.requests.some((request) => state.decisions.get(request) === true)) {
    return "allowed";
  }
  return run.requests.every((request) => state.decisions.get(request) === false)
    ? "denied"
    : "undecided";
}

// 実行が終わる。含めた依頼を、解決する依頼として返す。
export function settleListRun(
  state: ListRequests,
  run: ListRun,
): { state: ListRequests; answered: readonly number[] } {
  if (!state.runs.has(run)) return { state, answered: [] };
  const answered = run.requests.filter((request) =>
    state.decisions.has(request),
  );
  const decisions = new Map(state.decisions);
  for (const request of answered) decisions.delete(request);
  const runs = new Set(state.runs);
  runs.delete(run);
  return { state: { ...state, decisions, runs }, answered };
}

// 停止。待っている依頼と、実行に含めた依頼の全てを、解決する依頼として返し、成否と実行を空にする。latestは残す。
export function stopLists(state: ListRequests): {
  state: ListRequests;
  answered: readonly number[];
} {
  return {
    state: { ...EMPTY_LIST_REQUESTS, latest: state.latest },
    answered: [...state.decisions.keys()],
  };
}

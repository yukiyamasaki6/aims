// 開く依頼の集約。詳細を開く依頼の番号、待っている依頼、結果の記録の権利、取り直しの結果の分類を、変更しない値と関数にしたもの。
// `Promise`と通知を持たない。依頼の番号ごとの結果を渡す先は、手続きが持つ。

// 取り直しの結果の分類。
export type RoundOutcome = "ok" | "gone" | "failed";

// 1回の実行。番号を持たず、値の同一性で見分ける。answersは、実行を始めた時点に待っていた開く依頼の番号。
export type OpenRun = {
  readonly roundId: string;
  readonly answers: readonly number[];
};

// ラウンドごとの状態。latestは最後の開く依頼の番号(停止でも数え直さない)。holderは結果の記録の権利を持つ実行。
type OpenRound = {
  readonly latest: number;
  readonly waiting: readonly number[];
  readonly holder: OpenRun | null;
  readonly outcome?: RoundOutcome;
};

export type OpenRequests = ReadonlyMap<string, OpenRound>;

export const EMPTY_OPEN_REQUESTS: OpenRequests = new Map();

const NEW_ROUND: OpenRound = { latest: 0, waiting: [], holder: null };

function withRound(
  state: OpenRequests,
  roundId: string,
  round: OpenRound,
): OpenRequests {
  const next = new Map(state);
  next.set(roundId, round);
  return next;
}

// 開く依頼を受ける。番号を進め、待ちに足し、結果の記録を消し、記録の権利を消す。
export function requestOpen(
  state: OpenRequests,
  roundId: string,
): { state: OpenRequests; request: number } {
  const round = state.get(roundId) ?? NEW_ROUND;
  const request = round.latest + 1;
  return {
    state: withRound(state, roundId, {
      latest: request,
      waiting: [...round.waiting, request],
      holder: null,
    }),
    request,
  };
}

// 実行を始める。待っている依頼を答える依頼として控え、記録の権利をこの実行へ移す。
export function beginOpenRun(
  state: OpenRequests,
  roundId: string,
): { state: OpenRequests; run: OpenRun } {
  const round = state.get(roundId) ?? NEW_ROUND;
  const run: OpenRun = { roundId, answers: [...round.waiting] };
  return { state: withRound(state, roundId, { ...round, holder: run }), run };
}

// 実行が終わる。記録の権利を持つ実行だけが結果を記録する。答える依頼のうちまだ待っているものを、解決する依頼として返す。
// changedは、記録か待ちが変わったときだけ真である。
export function settleOpenRun(
  state: OpenRequests,
  run: OpenRun,
  outcome: RoundOutcome,
): { state: OpenRequests; answered: readonly number[]; changed: boolean } {
  const round = state.get(run.roundId);
  if (!round) return { state, answered: [], changed: false };
  const answered = run.answers.filter((request) =>
    round.waiting.includes(request),
  );
  const records = round.holder === run && round.outcome !== outcome;
  if (!records && answered.length === 0) {
    return { state, answered: [], changed: false };
  }
  return {
    state: withRound(state, run.roundId, {
      ...round,
      waiting: round.waiting.filter((request) => !answered.includes(request)),
      outcome: records ? outcome : round.outcome,
    }),
    answered,
    changed: true,
  };
}

// 停止。全ての待ちを解決する依頼として返し、待ちと記録の権利を空にする。latestとoutcomeは残す。
export function stopOpens(state: OpenRequests): {
  state: OpenRequests;
  answered: readonly { roundId: string; request: number }[];
} {
  const answered: { roundId: string; request: number }[] = [];
  const next = new Map<string, OpenRound>();
  for (const [roundId, round] of state) {
    for (const request of round.waiting) answered.push({ roundId, request });
    next.set(roundId, { ...round, waiting: [], holder: null });
  }
  return { state: next, answered };
}

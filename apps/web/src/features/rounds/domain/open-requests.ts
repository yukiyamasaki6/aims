// 開く依頼の集約。詳細を開く依頼の番号、待っている依頼、見つからなかったかの記録を、変更しない値と関数にしたもの。
// `Promise`と通知を持たない。依頼の番号ごとの結果を渡す先は、手続きが持つ。

// 1回の実行。番号を持たず、値の同一性で見分ける。answersは、実行を始めた時点に待っていた開く依頼の番号。
export type OpenRun = {
  readonly roundId: string;
  readonly answers: readonly number[];
};

// ラウンドごとの状態。latestは最後の開く依頼の番号。goneは、最後に終わった実行でラウンドが見つからなかったか。
type OpenRound = {
  readonly latest: number;
  readonly waiting: readonly number[];
  readonly gone: boolean;
};

export type OpenRequests = ReadonlyMap<string, OpenRound>;

export const EMPTY_OPEN_REQUESTS: OpenRequests = new Map();

const NEW_ROUND: OpenRound = { latest: 0, waiting: [], gone: false };

function withRound(
  state: OpenRequests,
  roundId: string,
  round: OpenRound,
): OpenRequests {
  const next = new Map(state);
  next.set(roundId, round);
  return next;
}

// 開く依頼を受ける。番号を進め、待ちに足し、見つからなかった記録を消す。
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
      gone: false,
    }),
    request,
  };
}

// 実行を始める。待っている依頼を、この実行が答える依頼として控える。
export function beginOpenRun(state: OpenRequests, roundId: string): OpenRun {
  return { roundId, answers: [...(state.get(roundId)?.waiting ?? [])] };
}

// 実行が終わる。見つからなかったかは、最後に終わった実行の結果にする。答える依頼のうちまだ待っているものを、解決する依頼として返す。
// changedは、見つからなかったかか待ちが変わったときだけ真である。
export function settleOpenRun(
  state: OpenRequests,
  run: OpenRun,
  gone: boolean,
): { state: OpenRequests; answered: readonly number[]; changed: boolean } {
  const round = state.get(run.roundId) ?? NEW_ROUND;
  const answered = run.answers.filter((request) =>
    round.waiting.includes(request),
  );
  if (round.gone === gone && answered.length === 0) {
    return { state, answered: [], changed: false };
  }
  return {
    state: withRound(state, run.roundId, {
      ...round,
      waiting: round.waiting.filter((request) => !answered.includes(request)),
      gone,
    }),
    answered,
    changed: true,
  };
}

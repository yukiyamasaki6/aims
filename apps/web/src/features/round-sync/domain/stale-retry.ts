const BASE_DELAY_MS = 3000;
const MAX_DELAY_MS = 60000;

// 端末のベースで開いたままの詳細を取り直す間隔。初回を0とする試行の番号から指数で伸ばし、上限で止める。
// 送信のリトライの待機(ラウンドの規則)とは変わる理由が別で、式と値が同じなのは偶然のため、共有しない。
export function staleRetryDelayMs(attemptIndex: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attemptIndex, MAX_DELAY_MS);
}

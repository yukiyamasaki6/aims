import type { BatchResult, SyncResultDecision } from "./sync-queue-types";

// リトライ対象外（サインイン画面への誘導は別issue #303で扱う）。
export const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

// 再試行ごとの待機時間。要素数が再試行の上限回数になる。
export const RETRY_DELAYS_MS = [3000, 6000, 12000, 24000];

// 送信処理の例外も、失敗の結果として同じ経路で扱えるようにする。
export function toSafeResult(
  promise: Promise<BatchResult>,
): Promise<BatchResult> {
  return promise.catch((e) => ({
    error: e instanceof Error ? e.message : "予期しないエラーが発生しました。",
  }));
}

// attemptIndexは初回を0とする試行の番号。
export function decideSyncResult(
  result: BatchResult,
  attemptIndex: number,
): SyncResultDecision {
  const permanent = result?.permanent === true;
  if (
    result?.error &&
    result.error !== AUTH_REQUIRED_MESSAGE &&
    !permanent &&
    attemptIndex < RETRY_DELAYS_MS.length
  ) {
    return { type: "retry", delayMs: RETRY_DELAYS_MS[attemptIndex] };
  }
  return {
    type: "settle",
    // 再試行で解消し得る失敗は、再読み込み後に再送できるようoutboxに残す。
    removeFromOutbox: !result?.error || permanent,
    notifyPermanentFailure:
      permanent && result?.error !== AUTH_REQUIRED_MESSAGE,
  };
}

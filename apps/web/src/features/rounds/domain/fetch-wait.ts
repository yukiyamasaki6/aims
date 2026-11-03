import type { FetchResult } from "./fetch-status";

// 取得が終わらないまま枠が「読み込み中」に固定されないよう、全体に時間制限を設ける。
// navigator.onLineがtrueのまま通信できない場合、アクセストークンが期限切れだと
// 認証の読み取りの更新の再試行だけで約30秒、通信が応答しないと数分止まるため。
// 超えたら原因を断定せずerrorとして再試行できるようにする（遅れて届いた結果は捨てる）。
export const FETCH_TIMEOUT_MS = 10_000;

// 上限に達したときの代わりがある待ちはFALLBACK_WAIT_MS、無い待ちはFETCH_TIMEOUT_MSにする。
export const FALLBACK_WAIT_MS = 1_000;

// 代わり(保存済み)の有無で、結果を返すまでの待ちの上限を選ぶ。
export function waitLimitMs(hasFallback: boolean): number {
  return hasFallback ? FALLBACK_WAIT_MS : FETCH_TIMEOUT_MS;
}

// 取得できなければ代わりを返す。代わりが無ければ取得の結果をそのまま返す。
export function withFallback<T>(
  result: FetchResult<T>,
  fallback: T | null,
): FetchResult<T> {
  if (result.status === "ok") return result;
  return fallback === null ? result : { status: "ok", data: fallback };
}

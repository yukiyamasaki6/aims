export type FetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "not-found" }
  | { status: "offline" }
  | { status: "error"; message: string };

// loadingは画面の状態で、取得関数は返さない。
export type FetchView<T> = { status: "loading" } | FetchResult<T>;

export const FETCH_ERROR_MESSAGE = "読み込めませんでした。";

export type ResponseLike<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
  status: number;
};

// 認証の拒否。セッションの問題かは応答だけでは決まらないため、取得の側で更新を強制して確かめる(fetch-content.ts)。
export function isAuthRejected(res: ResponseLike<unknown>): boolean {
  return res.status === 401 || res.error?.code === "PGRST301";
}

// 通信失敗はpostgrest-jsが例外にせずstatus 0で返す。error.messageの文字列には依存しない。
// 認証の拒否は取得の側でセッションを確かめ終えた後のため、ほかのエラーと同じくerrorにする。
// 回線の断はnavigator.onLineがfalseのときだけofflineとし、status 0は原因を断定せずerrorにする。
// not-foundは単一対象の取得だけで、配列の0件はokとする。
export function classifyResponse<T>(
  res: ResponseLike<T>,
  opts: { nullIsNotFound?: boolean } = {},
): FetchResult<T> {
  if (res.status === 0)
    return { status: "error", message: FETCH_ERROR_MESSAGE };
  if (res.error?.code === "PGRST116") return { status: "not-found" };
  if (res.error) return { status: "error", message: FETCH_ERROR_MESSAGE };
  if (res.data === null && opts.nullIsNotFound) return { status: "not-found" };
  // nullIsNotFoundでなければ、nullも取得結果の値としてそのまま返す。
  return { status: "ok", data: res.data as T };
}

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

// 通信失敗由来の結果。取得中に回線が落ちてオフラインになっていればofflineにし、
// 復帰のonlineイベントで再取得できるようにする。それ以外は原因を断定せずerrorにする。
export function commFailure<T>(offline: boolean): FetchResult<T> {
  if (offline) return { status: "offline" };
  return { status: "error", message: FETCH_ERROR_MESSAGE };
}

// 取得できなければ代わりを返す。代わりが無ければ取得の結果をそのまま返す。
export function withFallback<T>(
  result: FetchResult<T>,
  fallback: T | null,
): FetchResult<T> {
  if (result.status === "ok") return result;
  return fallback === null ? result : { status: "ok", data: fallback };
}

// 複数の取得を1つの結果に畳むときの優先順。通信失敗→未認証→その他のエラー。
export function foldFailures(
  responses: readonly ResponseLike<unknown>[],
): ResponseLike<unknown> | undefined {
  const failed = responses.filter((r) => r.status === 0 || r.error);
  return (
    failed.find((r) => r.status === 0) ??
    failed.find(isAuthRejected) ??
    failed[0]
  );
}

export type FetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "not-found" }
  | { status: "offline" }
  | { status: "error"; message: string };

// loadingは画面の状態で、取得関数は返さない。
export type FetchView<T> = { status: "loading" } | FetchResult<T>;

export const FETCH_ERROR_MESSAGE = "読み込めませんでした。";

// 通信失敗由来の結果。取得中に回線が落ちてオフラインになっていればofflineにし、
// 復帰のonlineイベントで再取得できるようにする。それ以外は原因を断定せずerrorにする。
export function commFailure<T>(offline: boolean): FetchResult<T> {
  if (offline) return { status: "offline" };
  return { status: "error", message: FETCH_ERROR_MESSAGE };
}

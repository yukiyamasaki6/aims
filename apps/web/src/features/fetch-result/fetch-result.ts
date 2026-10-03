import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";

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

// 通信失敗はpostgrest-jsが例外にせずstatus 0で返す。error.messageの文字列には依存しない。
// 回線の断はnavigator.onLineがfalseのときだけofflineとし、status 0は原因を断定せずerrorにする。
// not-foundは単一対象の取得だけで、配列の0件はokとする。
export function classifyResponse<T>(
  res: ResponseLike<T>,
  opts: { nullIsNotFound?: boolean } = {},
): FetchResult<T> {
  if (res.status === 0)
    return { status: "error", message: FETCH_ERROR_MESSAGE };
  if (res.status === 401 || res.error?.code === "PGRST301") {
    return { status: "error", message: AUTH_REQUIRED_MESSAGE };
  }
  if (res.error?.code === "PGRST116") return { status: "not-found" };
  if (res.error) return { status: "error", message: FETCH_ERROR_MESSAGE };
  if (res.data === null && opts.nullIsNotFound) return { status: "not-found" };
  // nullIsNotFoundでなければ、nullも取得結果の値としてそのまま返す。
  return { status: "ok", data: res.data as T };
}

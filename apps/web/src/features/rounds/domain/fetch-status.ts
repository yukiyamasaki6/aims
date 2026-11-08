import type { QueryOutcome } from "./query-outcome";

// 書き込み側のサインインの確認の失敗の種類。unauthenticated: サインインが必要。unreachable: サインインの状態を確かめられない(通信できない)。
export type SignInFailure = "unauthenticated" | "unreachable";
// 取得の失敗の種類。unauthenticated: サインインが必要。failed: それ以外。
export type FetchFailure = "unauthenticated" | "failed";

export type FetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "not-found" }
  | { status: "offline" }
  | { status: "error"; reason: FetchFailure };

// loadingは画面の状態で、取得関数は返さない。
export type FetchView<T> = { status: "loading" } | FetchResult<T>;

// サインインを確かめられなかったことを、失敗の種類へ写す。未認証はサインインを促し、不明(通信失敗)は通信できないことを示す。
export function signInFailure(
  status: "unauthenticated" | "unknown",
): SignInFailure {
  return status === "unauthenticated" ? "unauthenticated" : "unreachable";
}

// 通信失敗由来の結果。取得中に回線が落ちてオフラインになっていればofflineにし、
// 復帰のonlineイベントで再取得できるようにする。それ以外は原因を断定せずerrorにする。
export function commFailure<T>(offline: boolean): FetchResult<T> {
  if (offline) return { status: "offline" };
  return { status: "error", reason: "failed" };
}

// 問い合わせの結果の種類を、利用者向けの結果へ対応させる。失敗の種類を付けるのはここだけ。
// 認証の拒否は、取得の側でセッションを確かめ直した後に残ったものなので、ほかのエラーと同じくerrorにする。
// 回線の断はnavigator.onLineがfalseのときだけofflineとし、通信失敗は原因を断定せずerrorにする。
export function fetchResultOf<T>(
  outcome: QueryOutcome<T>,
  offline: boolean,
): FetchResult<T> {
  switch (outcome.status) {
    case "ok":
      return { status: "ok", data: outcome.data };
    case "not-found":
      return { status: "not-found" };
    case "comm-failure":
      return commFailure(offline);
    case "auth-rejected":
    case "failed":
      return { status: "error", reason: "failed" };
  }
}

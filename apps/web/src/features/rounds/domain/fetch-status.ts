import type { QueryOutcome } from "./query-outcome";

// 保存・削除・開始・取得の失敗の種類が共有する、サインインの確認の失敗。unauthenticated: サインインが必要。確かめられない(不明)ときは失敗にしない。
export type SignInFailure = "unauthenticated";
// 取得の失敗の種類。unauthenticated: サインインが必要。failed: それ以外。
export type FetchFailure = "unauthenticated" | "failed";

export type FetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "not-found" }
  | { status: "offline" }
  | { status: "error"; reason: FetchFailure };

// loadingは画面の状態で、取得関数は返さない。
export type FetchView<T> = { status: "loading" } | FetchResult<T>;

// 取得中か、取得に失敗した(okでない)とき、保存済みがあれば、保存済みをokとして見せる。取得できたら取得の結果を見せる。
export function withSaved<T>(
  view: FetchView<T>,
  saved: T | null,
): FetchView<T> {
  if (view.status === "ok" || saved === null) return view;
  return { status: "ok", data: saved };
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

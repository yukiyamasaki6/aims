import type { ResendWaitError } from "./auth-code";
import type { CaptchaError } from "./captcha-token";
import type { EmailError } from "./email-address";
import type { PasswordError } from "./password";

// 操作の流れ(集約)が共通に使う型。4つの操作の集約が、同じ形の命令の結果を返す。

// 欄ごとの入力の誤りの種類。欄の名前ごとに、その欄で起きる誤りの種類が決まる。
export type FieldErrorKinds = {
  email: EmailError;
  password: PasswordError;
  captcha: CaptchaError;
  resend: ResendWaitError;
};

// 欄ごとのエラー。キーは欄の名前、値は誤りの種類。
export type FieldErrors<Field extends keyof FieldErrorKinds> = {
  readonly [F in Field]?: FieldErrorKinds[F];
};

// 操作の開始の結果。命令を受けた後の状態(state)と、認証サービスへ頼む内容(request)を持つ。
// - 開始する: 実行中の状態と、request。
// - 開始しない(request が null): 実行中のときは、状態は受けたまま(副作用なし)。入力に不備があるときは、不備を示す状態(error・fieldErrors)。
export type Start<State, Request> = {
  readonly state: State;
  readonly request: Request | null;
};

// 開始の後の命令の結果。新しい状態と、命令の結果。
export type Step<State, Result> = {
  readonly state: State;
  readonly result: Result;
};

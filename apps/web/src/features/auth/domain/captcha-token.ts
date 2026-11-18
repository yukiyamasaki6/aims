// セキュリティチェックのトークンと、チェックの待ちの規則。チェックを要する4つの集約が、同じ規則を使う。
// 誤りの種類。incomplete: チェックが完了していない(失敗した、または待ちの上限を超えた)。
export type CaptchaError = "incomplete";

// チェックの待ちの上限(ミリ秒)。追加チェックが表示されていない間に、トークンも失敗の通知も無いまま、この時間が過ぎたら待ちを打ち切る。計測に基づく値ではない。
export const CHECK_WAIT_LIMIT_MS = 10_000;

export function isCaptchaCompleted(token: string | null): token is string {
  return token !== null && token !== "";
}

// チェックの待ちを持つ集約の状態。
// awaitingCheck: チェック未完了のまま押された操作が、トークンを待っている(実行中のまま)。
export type CheckWaiting = {
  readonly captchaToken: string | null;
  readonly awaitingCheck: boolean;
  readonly fieldErrors: { readonly captcha?: CaptchaError };
};

// 待ちを解く遷移。待ちと実行中(idle)を解き、チェックのエラーを示す。トークンは使わない。
function releaseCheckWait<F extends CheckWaiting>(
  flow: F,
  idle: Partial<F>,
): F {
  return {
    ...flow,
    ...idle,
    awaitingCheck: false,
    fieldErrors: { ...flow.fieldErrors, captcha: "incomplete" },
  };
}

// 画面で起きた、チェックの待ちを解く事実。checkWaitReleased: 部品の失敗(エラー、未対応)、または待ちの上限。
export type CheckEvent = { type: "checkWaitReleased" };

// 待ちを解く事実を反映する。待ちの間だけ、待ちを解いてチェックのエラーを示す(待ちでなければ何も変えない)。
export function applyCheckWaitReleased<F extends CheckWaiting>(
  flow: F,
  idle: Partial<F>,
): F {
  return flow.awaitingCheck ? releaseCheckWait(flow, idle) : flow;
}

// トークンの到着(または失効のnull)を反映する。トークンが届くと、チェックのエラーを解く。待ちは解かない(待ち中の失効でも続く)。
export function applyCheckedToken<F extends CheckWaiting>(
  flow: F,
  token: string | null,
): F {
  return isCaptchaCompleted(token)
    ? {
        ...flow,
        captchaToken: token,
        fieldErrors: { ...flow.fieldErrors, captcha: undefined },
      }
    : { ...flow, captchaToken: token };
}

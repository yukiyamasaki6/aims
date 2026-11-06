// 認証サービスが発行する認証コード(OTP)の規則。桁数(入力欄の上限)と、再送できるまでの待ち時間。
// コードの形式(桁数、数字か)は検査せず認証サービスに任せる。未入力だけを送信前に見る。
export const AUTH_CODE_LENGTH = 6;

// 認証コードの誤りの種類。required: 未入力。
export type AuthCodeError = "required";

// 入力されたコードが空でないかだけを見る。
// 入力されていればundefined、空なら誤りの種類を返す。
export function validateAuthCode(code: string): AuthCodeError | undefined {
  return code ? undefined : "required";
}

// 認証コードを送ってから、再送できるまでの待ち時間(秒)。
export const RESEND_COOLDOWN_SECONDS = 60;

// 再送の待ちの誤りの種類。cooldown: 待ち時間が残っている。
export type ResendWaitError = "cooldown";

// 待ち時間が残っていれば誤りの種類を、無ければundefinedを返す。
export function validateResendWait(
  remainingSeconds: number,
): ResendWaitError | undefined {
  return remainingSeconds > 0 ? "cooldown" : undefined;
}

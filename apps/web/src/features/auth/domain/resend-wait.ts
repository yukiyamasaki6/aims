// 認証コードを送ってから、再送できるまでの待ち時間(秒)。
export const RESEND_COOLDOWN_SECONDS = 60;

// 待ち時間が残っていれば利用者向けの文言を、無ければundefinedを返す。
export function validateResendWait(
  remainingSeconds: number,
): string | undefined {
  return remainingSeconds > 0
    ? "再送はクールダウン中です。しばらくしてから再度お試しください。"
    : undefined;
}

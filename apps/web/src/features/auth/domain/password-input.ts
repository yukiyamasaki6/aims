// 入力されたパスワードが空でないかだけを見る。登録時の強さの規則は、ここに含めない。
// 入力されていればundefined、空なら利用者向けの文言を返す。
export function validatePasswordPresent(password: string): string | undefined {
  return password ? undefined : "パスワードを入力してください。";
}

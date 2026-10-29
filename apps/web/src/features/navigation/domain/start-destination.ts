// 開始の行き先の規則。判定中と未認証はサインアップ、認証済みと確かめられないときはサインインの後の既定の行き先へ送る。
// 確かめられないときに未認証なら、その行き先の保護(要求の入口)がサインインへ送る。
export type SignInStatus = "authenticated" | "unauthenticated" | "unknown";

// 行き先の経路。どちらも認証の機能から受け取る。
export type StartPaths = {
  // サインアップの画面のパス。
  readonly signUpPath: string;
  // サインインの後の既定の行き先。
  readonly signedInPath: string;
};

// status: 判定中はnull。
export function startDestination(
  status: SignInStatus | null,
  paths: StartPaths,
): string {
  return status === null || status === "unauthenticated"
    ? paths.signUpPath
    : paths.signedInPath;
}

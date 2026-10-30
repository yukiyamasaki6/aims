import {
  destinationOf,
  type SessionReader,
  SIGN_UP_PATH,
} from "@/features/auth";
import { ROUNDS_PATH } from "@/features/rounds";
import type { SignInCheck } from "../application/start";

// 開始の行き先の材料を、認証とラウンドの機能の入口で満たす。認証の読み取り結果から分類だけを取り出す。
// サインインの後の既定の行き先は、認証の規則が、ラウンドの機能が公開する一覧の経路から決める。
export function createAuthSignInCheck(
  sessionReader: SessionReader,
): SignInCheck {
  return {
    signUpPath: SIGN_UP_PATH,
    signedInPath: destinationOf(null, ROUNDS_PATH),
    readStatus: async () => (await sessionReader.readSession()).status,
  };
}

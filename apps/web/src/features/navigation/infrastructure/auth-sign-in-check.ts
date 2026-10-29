import {
  DEFAULT_DESTINATION,
  type SessionReader,
  SIGN_UP_PATH,
} from "@/features/auth";
import type { SignInCheck } from "../application/start";

// 開始の行き先の材料を、認証の機能の入口で満たす。認証の読み取り結果から分類だけを取り出し、経路は認証の定数を渡す。
export function createAuthSignInCheck(
  sessionReader: SessionReader,
): SignInCheck {
  return {
    signUpPath: SIGN_UP_PATH,
    signedInPath: DEFAULT_DESTINATION,
    readStatus: async () => (await sessionReader.readSession()).status,
  };
}

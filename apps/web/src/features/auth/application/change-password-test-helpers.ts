import { vi } from "vitest";
import type { CallResult } from "./call-result";
import type { ChangePasswordAuthenticator } from "./change-password";

// 更新の頼みごとの偽の認証。呼び出しを記録し、渡した結果を返す。
// 手続き(application)と画面(UI)のテストが共有する。
export function createFakeChangePasswordAuthenticator(
  result: CallResult = { kind: "accepted" },
) {
  return {
    updatePassword: vi.fn(
      async (_request: {
        currentPassword: string;
        newPassword: string;
      }): Promise<CallResult> => result,
    ),
  } satisfies ChangePasswordAuthenticator;
}

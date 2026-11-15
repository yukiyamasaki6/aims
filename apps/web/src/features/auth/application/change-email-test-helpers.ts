import { vi } from "vitest";
import type { CallResult } from "./call-result";
import type {
  ChangeEmailAuthenticator,
  EmailChangeConfirmResult,
  EmailChangeRequestResult,
} from "./change-email";

export const FAKE_CURRENT_EMAIL = "current@example.com";

// メールアドレス変更の偽の認証。呼び出しを記録し、渡した結果を返す。
// 手続き(application)と画面(UI)のテストが共有する。
export function createFakeChangeEmailAuthenticator(
  results: {
    currentEmail?: string | null;
    request?: EmailChangeRequestResult;
    confirm?: EmailChangeConfirmResult;
    resend?: CallResult;
  } = {},
) {
  const {
    currentEmail = FAKE_CURRENT_EMAIL,
    request = { kind: "accepted", currentEmail: FAKE_CURRENT_EMAIL },
    confirm = { kind: "partial" },
    resend = { kind: "accepted" },
  } = results;
  return {
    readCurrentEmail: vi.fn(async (): Promise<string | null> => currentEmail),
    requestEmailChange: vi.fn(
      async (_request: {
        newEmail: string;
      }): Promise<EmailChangeRequestResult> => request,
    ),
    confirmEmailChange: vi.fn(
      async (_request: {
        email: string;
        code: string;
      }): Promise<EmailChangeConfirmResult> => confirm,
    ),
    resendEmailChangeCode: vi.fn(
      async (_request: {
        email: string;
        captchaToken: string;
      }): Promise<CallResult> => resend,
    ),
  } satisfies ChangeEmailAuthenticator;
}

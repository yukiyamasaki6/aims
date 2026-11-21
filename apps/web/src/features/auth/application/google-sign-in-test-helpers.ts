import { vi } from "vitest";
import type { CallResult } from "./call-result";
import type { GoogleSignInAuthenticator } from "./google-sign-in";

const accepted: CallResult = { kind: "accepted" };

// Googleでのサインインの認証の偽物。結果は既定で成功。テストが`mockResolvedValueOnce`などで替える。
export function createFakeGoogleSignInAuthenticator() {
  return {
    startGoogleSignIn: vi.fn(
      async (_request: { returnPath: string }): Promise<CallResult> => accepted,
    ),
    exchangeGoogleCode: vi.fn(
      async (_code: string): Promise<CallResult> => accepted,
    ),
  } satisfies GoogleSignInAuthenticator;
}

import { vi } from "vitest";
import type { AccountSummary } from "../domain/account-summary";
import type { CallResult } from "./call-result";
import type {
  AccountReading,
  EmailIdentityPreparation,
  LinkGoogleAuthenticator,
} from "./link-google";

const accepted: CallResult = { kind: "accepted" };

// Googleの追加・解除の認証の偽物。結果は既定で成功し、読み直しは渡した概要を返す。テストが`mockResolvedValue`などで替える。
export function createFakeLinkGoogleAuthenticator(reading: AccountReading) {
  return {
    startGoogleLink: vi.fn(
      async (_request: { returnPath: string }): Promise<CallResult> => accepted,
    ),
    readAccount: vi.fn(async (): Promise<AccountReading> => reading),
    unlinkGoogle: vi.fn(
      async (_identityId: string): Promise<CallResult> => accepted,
    ),
  } satisfies LinkGoogleAuthenticator;
}

// メールの手段の準備の偽物。結果は既定で成功。
export function createFakeEmailIdentityPreparation() {
  return {
    ensure: vi.fn(async (): Promise<CallResult> => accepted),
  } satisfies EmailIdentityPreparation;
}

// 読み直しの成功の結果。
export function readingOf(account: AccountSummary): AccountReading {
  return { kind: "read", account };
}

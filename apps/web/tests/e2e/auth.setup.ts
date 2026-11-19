import { test as setup } from "./fixtures";
import {
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  saveSharedEmail,
  signUpAndSignIn,
} from "./helpers/auth";

// OTP認証の疎通を確認し、既存specが指定する認証状態ファイルを用意する。
// 各ケースのセッションは自動fixtureが固有利用者で作り直す。
setup("共有E2Eユーザーの認証状態を準備する", async ({ page }) => {
  const email = `e2e-shared-${Date.now()}@aims.test`;

  await signUpAndSignIn(page, {
    email,
    password: SHARED_PASSWORD,
  });
  await page.context().storageState({ path: SHARED_AUTH_STATE_PATH });
  saveSharedEmail(email);
});

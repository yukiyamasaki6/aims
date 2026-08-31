import { test as setup } from "@playwright/test";
import {
  SHARED_AUTH_STATE_PATH,
  SHARED_EMAIL,
  SHARED_PASSWORD,
  signUpAndSignIn,
} from "./helpers/auth";

// データ作成を伴うがユーザー固有の状態（一覧の件数や「無い」ことの検証等）に
// 依存しないテストは、この共有ユーザーの認証状態を使い回すことでサインイン処理を
// スイート全体で1回に減らし、並列実行時のSupabaseスタックへの負荷を抑える。
setup("共有E2Eユーザーの認証状態を準備する", async ({ page }) => {
  await signUpAndSignIn(page, {
    email: SHARED_EMAIL,
    password: SHARED_PASSWORD,
  });
  await page.context().storageState({ path: SHARED_AUTH_STATE_PATH });
});

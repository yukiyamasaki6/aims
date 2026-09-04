import { test as setup } from "@playwright/test";
import {
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  saveSharedEmail,
  signUpAndSignIn,
} from "./helpers/auth";

// データ作成を伴うがユーザー固有の状態（一覧の件数や「無い」ことの検証等）に
// 依存しないテストは、この共有ユーザーの認証状態を使い回すことでサインイン処理を
// スイート全体で1回に減らし、並列実行時のSupabaseスタックへの負荷を抑える。
// 実行のたびに使い捨てのメールアドレスにすることで、過去の実行で作成した
// ラウンド・プリセットがこのユーザーには一切見えない状態（＝一覧が必ず空
// から始まる）を保証する。
setup("共有E2Eユーザーの認証状態を準備する", async ({ page }) => {
  const email = `e2e-shared-${Date.now()}@aims.test`;

  await signUpAndSignIn(page, {
    email,
    password: SHARED_PASSWORD,
  });
  await page.context().storageState({ path: SHARED_AUTH_STATE_PATH });
  saveSharedEmail(email);
});

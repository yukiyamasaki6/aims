import { expect, test } from "../fixtures";
import { signUpAndSignIn, waitForHydration } from "../helpers/auth";

// サインインする新しい利用者を使うため、共有の認証状態を使わない。
test.use({ storageState: { cookies: [], origins: [] } });

const IDENTITY_KEY = "aims:local-user-id";

test("端末の識別情報がサインイン中の利用者と違う状態で開くと、ページ全体を1回だけ読み込み直し、識別情報の利用者で起動する", async ({
  page,
}) => {
  await signUpAndSignIn(page, {
    email: `user-switch-${Date.now()}@aims.test`,
    password: "password1",
  });
  await waitForHydration(page);
  const userId = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    IDENTITY_KEY,
  );
  expect(userId).not.toBeNull();

  // 識別情報だけを別の利用者へ書き換えて、一覧を開く。
  await page.evaluate(
    (key) => window.localStorage.setItem(key, "another-user"),
    IDENTITY_KEY,
  );
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  await page.goto("/rounds");

  // ルートの識別情報の記録(localIdentity)も、起動時の通知で識別情報を直す。この確認だけでは見張りの働きの証拠にならない。
  // 見張りの働きの証拠は、読み込みの回数である(1回目のgotoと、見張りによる1回の読み込み直し)。
  await expect
    .poll(() =>
      page
        .evaluate((key) => window.localStorage.getItem(key), IDENTITY_KEY)
        // 読み込み直しの最中は文脈が破棄される。次の確認で読む。
        .catch(() => null),
    )
    .toBe(userId);
  await waitForHydration(page);
  await expect(page).toHaveURL(/\/rounds$/);
  // 2回目の文書の識別情報とセッションが一致するため、さらに読み込み直さない(合計2回)。
  await page.waitForTimeout(2_000);
  expect(loads).toBe(2);
});

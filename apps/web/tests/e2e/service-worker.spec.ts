import { expect, test } from "@playwright/test";

// デプロイ更新時のキャッシュ切り替え（古いSWが新しいビルドのバンドルを
// 参照して壊れないこと）は、既存のPlaywrightセットアップ（1回のビルドに
// 対して全テストを実行する構成）では2回ビルドし直す必要があり複雑度が
// 高すぎるため、ここではテストしない。手動確認、または将来的に専用の
// 検証手段を用意する際に追加する。

test("初回アクセスでService Workerが登録される", async ({ page }) => {
  await page.goto("/");

  const registered = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return true;
  });

  expect(registered).toBe(true);
});

test("Manifestがname/icons/start_url/display:standaloneを含んで配信される", async ({
  page,
  request,
}) => {
  await page.goto("/");

  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);

  const manifest = await response.json();
  expect(manifest.name).toBeTruthy();
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThan(0);
  expect(manifest.start_url).toBeTruthy();
  expect(manifest.display).toBe("standalone");
});

test("オフライン下での再読み込みでも/offlineへのフォールバックが表示される（コールドスタート対応）", async ({
  page,
  context,
}) => {
  // /自体は認証依存（サインイン済みなら/roundsへリダイレクト）のため
  // プリキャッシュ対象外。オフライン時のナビゲーション失敗は、認証に
  // 依存しない静的な/offlineへのフォールバックで受け止める。
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByText("オフラインです")).toBeVisible();
});

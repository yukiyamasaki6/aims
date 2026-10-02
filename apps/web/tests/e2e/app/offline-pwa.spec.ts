import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH, waitForHydration } from "../helpers/auth";

// 認証に依存しない/を使い、Service Workerが有効になるまで待つ。
async function openWithServiceWorker(page: Page) {
  await page.goto("/");
  // 初回の読み込みと登録処理が落ち着く前に別のService Workerを登録すると、
  // 新しいService Workerが待機したままになることがあるため、通信の完了を待つ。
  await page.waitForLoadState("networkidle");
  // 有効化直後のclients.claim()でページが制御されるまで待つ。
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await new Promise<void>((resolve) => {
      const worker = registration.active;
      if (!worker || worker.state === "activated") return resolve();
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated") resolve();
      });
    });
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () =>
        resolve(),
      );
    });
  });
}

// Serwistのプリキャッシュに入っているURLの一覧を返す。
async function precachedUrls(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) =>
      name.startsWith("serwist-precache"),
    );
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
}

test("offline-pwa-01: 初回アクセスのとき、/を開くと、Service Workerが登録され、静的アセットがプリキャッシュされる", async ({
  page,
}) => {
  // Given: 初回アクセス（Service Workerが未登録）
  // When: /を開く
  await openWithServiceWorker(page);

  // Then: Service Workerが登録され、静的アセットがプリキャッシュされる
  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state;
  });
  expect(registered).toBe("activated");
  const urls = await precachedUrls(page);
  expect(urls.some((url) => url.includes("/_next/static/"))).toBe(true);
  expect(urls.some((url) => url.includes("/offline"))).toBe(true);
});

test("offline-pwa-02: Manifestを満たしているとき、/を開くと、ブラウザからアプリとしてインストールできる", async ({
  page,
  context,
}) => {
  // Given: Manifestを満たしている
  // When: /を開く
  await page.goto("/");

  // Then: ブラウザがアプリとして認識し、インストールできない理由を報告しない
  // ブラウザのインストール操作そのものは自動化できないため、
  // Chromiumがアプリとして認識するか（インストール可否の判定結果）で確かめる。
  const session = await context.newCDPSession(page);
  const manifest = await session.send("Page.getAppManifest");
  expect(manifest.url).toMatch(/\/manifest\.webmanifest$/);
  const { installabilityErrors } = await session.send(
    "Page.getInstallabilityErrors",
  );
  expect(installabilityErrors).toEqual([]);
});

test("offline-pwa-03: Service Workerが登録済みで新しいビルドが存在するとき、Service Workerの更新を確認すると、新しいService Workerが待機せず即座に有効になり、新しいビルドが参照される", async ({
  page,
  context,
}) => {
  // Given: Service Workerが登録済みで、新しいビルドのService Workerが存在する
  // 新しいビルドは、プリキャッシュ対象の/offlineのリビジョンが変わった/sw.jsとして模す。
  // Playwrightは同じURLの更新確認（registration.update()）の取得を差し替えられないため、
  // クエリ付きの別URLとして登録して、新しいService Workerが現れる状況を作る。
  await openWithServiceWorker(page);
  const oldRevision = (await precachedUrls(page))
    .find((url) => url.includes("/offline?__WB_REVISION__="))
    ?.split("__WB_REVISION__=")[1];
  expect(oldRevision).toBeDefined();
  const newRevision = "e2e-new-build";
  await context.route("**/sw.js*", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(
      oldRevision as string,
      newRevision,
    );
    await route.fulfill({ response, body });
  });

  // When: Service Workerの更新を確認する
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js?build=2");
  });

  // Then: 新しいService Workerが待機せず即座に有効になり、新しいビルドが参照される
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.ready;
          return {
            waiting: registration.waiting?.scriptURL ?? null,
            active: registration.active?.scriptURL.endsWith("/sw.js?build=2"),
            activeState: registration.active?.state,
            controlled:
              navigator.serviceWorker.controller?.scriptURL.endsWith(
                "/sw.js?build=2",
              ) ?? false,
          };
        }),
      { timeout: 10_000 },
    )
    .toEqual({
      waiting: null,
      active: true,
      activeState: "activated",
      controlled: true,
    });
  const urls = await precachedUrls(page);
  expect(urls.some((url) => url.endsWith(`=${newRevision}`))).toBe(true);
  expect(urls.some((url) => url.endsWith(`=${oldRevision}`))).toBe(false);
});

test("offline-pwa-04: Service Workerが登録済みでオフラインのとき、/を開くと、/offlineページが表示される", async ({
  page,
  context,
}) => {
  // Given: Service Workerが登録済みで、オフライン
  // /はプリキャッシュ対象外のため、
  // ナビゲーションの失敗を認証に依存しない静的な/offlineで受け止める。
  await openWithServiceWorker(page);
  await context.setOffline(true);

  // When: /を開く
  await page.goto("/");

  // Then: /offlineページが表示される
  await expect(
    page.getByRole("heading", { name: "オフラインです" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "インターネットに接続されていません。接続を確認してから、もう一度お試しください。",
    ),
  ).toBeVisible();
});

// アプリの起動そのものは自動化できないため、Manifestのstart_urlを読み、
// 起動時に開かれるURLをそのまま開くことで確かめる（offline-pwa-02と同じ方針）。
async function openStartUrl(page: Page, context: BrowserContext) {
  await page.goto("/");
  const session = await context.newCDPSession(page);
  const manifest = await session.send("Page.getAppManifest");
  expect(manifest.data, "manifestの本文を取得できること").toBeDefined();
  const { start_url } = JSON.parse(manifest.data as string) as {
    start_url?: string;
  };
  expect(start_url, "manifestにstart_urlがあること").toBeDefined();
  await page.goto(new URL(start_url as string, manifest.url).toString());
}

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("offline-pwa-05: 認証済みのとき、manifestのstart_urlを開くと、ラウンド一覧が表示される", async ({
    page,
    context,
  }) => {
    // Given: 認証済み
    // When: manifestのstart_urlを開く
    await openStartUrl(page, context);

    // Then: ラウンド一覧が表示される
    await expect(page).toHaveURL(/\/rounds$/);
    await waitForHydration(page);
    await expect(
      page.getByRole("heading", { name: "ラウンド一覧" }),
    ).toBeVisible();
  });
});

test("offline-pwa-06: 未認証のとき、manifestのstart_urlを開くと、/signinへ遷移する", async ({
  page,
  context,
}) => {
  // Given: 未認証
  // When: manifestのstart_urlを開く
  await openStartUrl(page, context);

  // Then: /signinへ遷移する
  await expect(page).toHaveURL(/\/signin$/);
});

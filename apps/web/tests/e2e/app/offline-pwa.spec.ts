import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

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

// ページのリクエストが一定時間途切れるまで待つ。
// 新しいService Workerを登録すると、Chromiumは有効化のために旧Service Workerを停止する。
// その瞬間に、制御下のページ（水和後のプリフェッチや遅延チャンクの読み込み）のfetchが届くと、
// 旧Service Workerが再起動して新しいService Workerが待機のまま残る競合が起きる。
// networkidleは500msの途切れで解けるが、負荷が高いとプリフェッチがその後に始まるため、
// 登録の前にページが静まるのを待つ。
async function waitForQuietPage(page: Page, quietMs = 1_500) {
  let lastRequestAt = Date.now();
  const onRequest = () => {
    lastRequestAt = Date.now();
  };
  page.on("request", onRequest);
  try {
    while (Date.now() - lastRequestAt < quietMs) {
      await page.waitForTimeout(100);
    }
  } finally {
    page.off("request", onRequest);
  }
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

// プリキャッシュに入る画面の枠。proxy.tsの対象外の/__shell/*で配られる。
const FRAME_PATHS = [
  "/__shell/rounds",
  "/__shell/rounds/new",
  "/__shell/rounds/_",
];

test("offline-pwa-01: 初回アクセスのとき、/を開くと、Service Workerが登録され、静的アセットと画面の枠がプリキャッシュされる", async ({
  page,
}) => {
  // Given: 初回アクセス（Service Workerが未登録）
  // When: /を開く
  await openWithServiceWorker(page);

  // Then: Service Workerが登録され、静的アセットと画面の枠がプリキャッシュされる
  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state;
  });
  expect(registered).toBe("activated");
  const urls = await precachedUrls(page);
  expect(urls.some((url) => url.includes("/_next/static/"))).toBe(true);
  expect(urls.some((url) => url.includes("/offline"))).toBe(true);
  for (const frame of FRAME_PATHS) {
    expect(
      urls.some((url) => url.includes(`${frame}?__WB_REVISION__=`)),
      `${frame}がプリキャッシュにあること`,
    ).toBe(true);
  }
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

// 未認証のまま/roundsを開くと、水和後にセッション喪失の判定が/signinへハードナビゲーションし、
// 取得済みのレスポンス本文が破棄されて読めなくなる。認証済みにして、/roundsに留まらせる。
test.describe("認証済みでService Workerの更新", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

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
    // 枠3件のリビジョンも差し替える。
    const oldFrameRevisions = new Map<string, string>();
    for (const frame of FRAME_PATHS) {
      const revision = (await precachedUrls(page))
        .find((url) => url.includes(`${frame}?__WB_REVISION__=`))
        ?.split("__WB_REVISION__=")[1];
      expect(revision, `${frame}の旧リビジョン`).toBeDefined();
      oldFrameRevisions.set(frame, revision as string);
    }
    await context.route("**/sw.js*", async (route) => {
      const response = await route.fetch();
      let body = (await response.text()).replaceAll(
        oldRevision as string,
        newRevision,
      );
      for (const revision of oldFrameRevisions.values()) {
        body = body.replaceAll(revision, newRevision);
      }
      await route.fulfill({ response, body });
    });

    // When: Service Workerの更新を確認する
    await waitForQuietPage(page);
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
    // 枠も新しいリビジョンに入れ替わり、旧リビジョンの枠は消える。
    for (const [frame, revision] of oldFrameRevisions) {
      expect(
        urls.some((url) =>
          url.endsWith(`${frame}?__WB_REVISION__=${newRevision}`),
        ),
        `${frame}が新リビジョンで入ること`,
      ).toBe(true);
      expect(
        urls.some((url) => url.endsWith(`=${revision}`)),
        `${frame}の旧リビジョンが消えること`,
      ).toBe(false);
    }
    // 更新後の/roundsのナビゲーションが、新リビジョンの枠(キャッシュ内の本文)を返す。
    // オフラインにして、キャッシュ以外から返せない状態で確かめる。
    const cachedFrame = await page.evaluate(async (revision) => {
      const cache = await caches.open(
        (await caches.keys()).find((name) =>
          name.startsWith("serwist-precache"),
        ) as string,
      );
      const hit = await cache.match(
        `/__shell/rounds?__WB_REVISION__=${revision}`,
      );
      return hit ? await hit.text() : null;
    }, newRevision);
    expect(cachedFrame, "新リビジョンの枠の本文").not.toBeNull();
    await context.unroute("**/sw.js*");
    await context.setOffline(true);
    const response = await page.goto("/rounds");
    expect(response?.fromServiceWorker()).toBe(true);
    expect(await response?.text()).toBe(cachedFrame);
  });
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

// ハイドレーション不一致(#418)などのページエラーを集める。本番ビルドで動くため、
// 枠のHTMLとクライアントの初回描画のずれはここで現れる。
function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/hydrat|#418|Minified React error/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  return errors;
}

// CDPのオフライン化とPlaywrightのsetOfflineのエミュレーションでは、オフラインのまま開いた文書の
// navigator.onLineがtrueのままになる(OSの回線断の実機ではない)。OSの回線断のようにonLine=falseで
// 文書が開く状態を再現するため、通信の遮断に加えてonLineをfalseにし、復帰ではonLineをtrueに戻してonlineイベントを発火する。
// init scriptはcontext全体に残るため、goOnline後に開く新規文書はonLine=falseに戻る(復帰後に遷移するテストでは注意)。
async function goOffline(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __offline: boolean };
    w.__offline = true;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => !w.__offline,
    });
  });
  await context.setOffline(true);
}

async function goOnline(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await page.evaluate(() => {
    (window as unknown as { __offline: boolean }).__offline = false;
    window.dispatchEvent(new Event("online"));
  });
}

// ビルド時に存在しないIDとして、ランダムなUUIDを使う(任意IDの枠を共有する証明)。
function unknownRoundPath(): string {
  return `/rounds/${randomUUID()}`;
}

test.describe("認証済みでService Workerが登録済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("offline-pwa-07: Service Workerが登録済みで認証済みのとき、/rounds/[id]を開くと、ラウンド詳細の枠が表示された後、内容が表示される", async ({
    page,
    context,
  }) => {
    // Given: Service Workerが登録済みで認証済み。内容の取得を保留できるようにする。
    const roundId = await createRound({
      email: getSharedEmail(),
      password: SHARED_PASSWORD,
      name: "枠の確認",
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
    });
    const errors = collectHydrationErrors(page);
    await openWithServiceWorker(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route("**/rest/v1/rounds?*", async (route) => {
      await gate;
      await route.continue();
    });

    // When: /rounds/[id]を開く
    const response = await page.goto(`/rounds/${roundId}`, {
      waitUntil: "commit",
    });

    // Then: 枠(Service Worker由来)が表示され、取得中が先に出てから内容が表示される
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByTestId("round-config-summary")).toHaveCount(0);
    release();
    await expect(page.getByTestId("round-config-summary")).toBeVisible();
    expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
  });

  test.describe("オフライン", () => {
    test("offline-pwa-09: Service Workerが登録済みで認証済みでオフラインで、プリセットを端末に保存していないとき、/rounds/newを開くと、ラウンド開始の枠と「ネットワークに接続されていません」が表示される", async ({
      page,
      context,
    }) => {
      // Given: Service Workerが登録済みで認証済みでオフラインで、プリセットを端末に保存していない
      const errors = collectHydrationErrors(page);
      await openWithServiceWorker(page);
      await goOffline(context);

      // When: /rounds/newを開く
      const response = await page.goto("/rounds/new");

      // Then: ラウンド開始の枠と「ネットワークに接続されていません」が表示される
      expect(response?.fromServiceWorker()).toBe(true);
      await expect(
        page.getByRole("heading", { name: "ラウンドを作成" }),
      ).toBeVisible();
      await expect(
        page.getByText("ネットワークに接続されていません"),
      ).toBeVisible();
      expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
    });

    test("offline-pwa-10: Service Workerが登録済みで認証済みでオフラインで、端末がオフラインで開けるベースを持たないラウンドのとき、/rounds/[id]を開くと、ラウンド詳細の枠と「ネットワークに接続されていません」が表示される", async ({
      page,
      context,
    }) => {
      // Given: Service Workerが登録済みで認証済みでオフラインで、端末がオフラインで開けるベースを持たない(ビルド時に存在しないID)
      const errors = collectHydrationErrors(page);
      await openWithServiceWorker(page);
      await goOffline(context);

      // When: /rounds/[id]を開く
      const response = await page.goto(unknownRoundPath());

      // Then: ラウンド詳細の枠と「ネットワークに接続されていません」が表示される
      expect(response?.fromServiceWorker()).toBe(true);
      await expect(
        page.getByRole("link", { name: "一覧へ戻る" }),
      ).toBeVisible();
      await expect(
        page.getByText("ネットワークに接続されていません"),
      ).toBeVisible();
      expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
    });
  });
});

test("offline-pwa-08: Service Workerが登録済みで認証済みでオフラインで、入力中のラウンドが無いとき、/roundsを開くと、ラウンド一覧の枠と「ネットワークに接続されていません」が表示される、「まだラウンドがありません。」は表示されない、入力中と「過去履歴」の見出しは表示されない", async ({
  page,
  context,
}) => {
  // Given: 入力中のラウンドが端末に入らないよう、使い捨てのユーザーでサインインし、オフラインにする
  const errors = collectHydrationErrors(page);
  await openWithServiceWorker(page);
  await signUpAndSignIn(page, {
    email: `e2e-offline-pwa-08-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
    password: "password-e2e-offline-pwa-08",
  });
  await goOffline(context);

  // When: /roundsを開く
  const response = await page.goto("/rounds");

  // Then: ラウンド一覧の枠と「ネットワークに接続されていません」が表示される
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "ラウンド一覧" }),
  ).toBeVisible();
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
  await expect(
    page.getByText("ネットワークに接続されていません"),
  ).toBeVisible();
  await expect(page.getByText("まだラウンドがありません。")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "入力中" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "過去履歴" })).toHaveCount(0);
  expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
});

test("offline-pwa-11: 未認証でService Workerが登録された後にサインインしてオフラインのとき、/roundsを開くと、ラウンド一覧の枠と「ネットワークに接続されていません」が表示される(サインイン画面は表示されない)", async ({
  page,
  context,
}) => {
  // Given: 未認証でService Workerを登録し、その後にサインインしてオフラインにする
  await openWithServiceWorker(page);
  const urls = await precachedUrls(page);
  for (const frame of FRAME_PATHS) {
    expect(
      urls.some((url) => url.includes(`${frame}?__WB_REVISION__=`)),
      `未認証の登録でも${frame}がプリキャッシュされること`,
    ).toBe(true);
  }
  // 保存された枠の本文に、サインイン画面にだけある入力欄がないこと(/signinのHTMLが枠として保存されていないこと)。
  const frameBodies = await page.evaluate(async (frames) => {
    const name = (await caches.keys()).find((n) =>
      n.startsWith("serwist-precache"),
    ) as string;
    const cache = await caches.open(name);
    const bodies: Record<string, string> = {};
    for (const request of await cache.keys()) {
      const frame = frames.find((f) =>
        request.url.includes(`${f}?__WB_REVISION__=`),
      );
      if (frame)
        bodies[frame] = (await (await cache.match(request))?.text()) ?? "";
    }
    return bodies;
  }, FRAME_PATHS);
  for (const frame of FRAME_PATHS) {
    const body = frameBodies[frame];
    expect(body, `${frame}の本文`).toBeTruthy();
    expect(body, `${frame}にメール入力欄がないこと`).not.toContain(
      'placeholder="you@example.com"',
    );
    expect(body, `${frame}にパスワード入力欄がないこと`).not.toContain(
      'placeholder="パスワード"',
    );
  }
  expect(frameBodies["/__shell/rounds"], "一覧の枠の本文").toContain(
    "ラウンド一覧",
  );
  await signUpAndSignIn(page, {
    email: `e2e-offline-pwa-11-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
    password: "password-e2e-offline-pwa-11",
  });
  await goOffline(context);

  // When: /roundsを開く
  const response = await page.goto("/rounds");

  // Then: ラウンド一覧の枠と「ネットワークに接続されていません」が表示され、サインイン画面は表示されない
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "ラウンド一覧" }),
  ).toBeVisible();
  await expect(
    page.getByText("ネットワークに接続されていません"),
  ).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);
  await expect(page.getByPlaceholder("パスワード")).toHaveCount(0);
  await expect(page).toHaveURL(/\/rounds$/);
});

test.describe("オフラインの枠からのオンライン復帰", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("offline-pwa-14: Service Workerが登録済みで認証済みでオフラインの/roundsの枠に「ネットワークに接続されていません」が表示されているとき、オンラインへ復帰すると、ラウンド一覧の内容が表示される、「ネットワークに接続されていません」が表示されなくなる", async ({
    page,
    context,
  }) => {
    // Given: オフラインの/roundsの枠に「ネットワークに接続されていません」が表示されている
    const roundId = await createRound({
      email: getSharedEmail(),
      password: SHARED_PASSWORD,
      name: "復帰の確認一覧",
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
    });
    await openWithServiceWorker(page);
    await goOffline(context);
    await page.goto("/rounds");
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toBeVisible();

    // When: オンラインへ復帰する
    await goOnline(context, page);

    // Then: ラウンド一覧の内容が表示され、「ネットワークに接続されていません」が表示されなくなる
    await expect(page.locator(`a[href="/rounds/${roundId}"]`)).toBeVisible();
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toHaveCount(0);
  });

  test("offline-pwa-15: Service Workerが登録済みで認証済みで、プリセットを端末に保存していないオフラインの/rounds/newの枠に「ネットワークに接続されていません」が表示されているとき、オンラインへ復帰すると、プリセット一覧が表示される、「ネットワークに接続されていません」が表示されなくなる", async ({
    page,
    context,
  }) => {
    // Given: プリセットを端末に保存していないオフラインの/rounds/newの枠に「ネットワークに接続されていません」が表示されている
    await openWithServiceWorker(page);
    await goOffline(context);
    await page.goto("/rounds/new");
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toBeVisible();

    // When: オンラインへ復帰する
    await goOnline(context, page);

    // Then: プリセット一覧が表示され、「ネットワークに接続されていません」が表示されなくなる
    await expect(page.getByTestId("round-preset-button").first()).toBeVisible();
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toHaveCount(0);
  });

  test("offline-pwa-16: Service Workerが登録済みで認証済みでオフラインで、端末がオフラインで開けるベースを持たないラウンドの/rounds/[id]の枠に「ネットワークに接続されていません」が表示されているとき、オンラインへ復帰すると、ラウンド詳細の内容が表示される、「ネットワークに接続されていません」が表示されなくなる", async ({
    page,
    context,
  }) => {
    // Given: 端末が最後に取得した後に作られ、オフラインで開けるベースを持たないラウンドの、オフラインの/rounds/[id]の枠に「ネットワークに接続されていません」が表示されている
    await openWithServiceWorker(page);
    await expect(page.getByTestId("round-base-refresher")).not.toHaveAttribute(
      "data-refreshed-count",
      "0",
    );
    const roundId = await createRound({
      email: getSharedEmail(),
      password: SHARED_PASSWORD,
      name: "復帰の確認詳細",
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
    });
    await goOffline(context);
    await page.goto(`/rounds/${roundId}`);
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toBeVisible();

    // When: オンラインへ復帰する
    await goOnline(context, page);

    // Then: ラウンド詳細の内容が表示され、「ネットワークに接続されていません」が表示されなくなる
    await expect(page.getByTestId("round-config-summary")).toBeVisible();
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toHaveCount(0);
  });
});

test("offline-pwa-12: Service Workerが登録済みで未認証のとき、/rounds/[id]を開くと、/signinへ遷移する", async ({
  page,
}) => {
  // Given: Service Workerが登録済みで未認証
  await openWithServiceWorker(page);

  // When: /rounds/[id]を開く
  const response = await page.goto(unknownRoundPath());

  // Then: 枠から/signinへ遷移する
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page).toHaveURL(/\/signin(\?|$)/);
});

test.describe("セッションが期限切れ", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("offline-pwa-13: Service Workerが登録済みでセッションが期限切れのとき、/roundsを開くと、/signinへ遷移する", async ({
    page,
    context,
  }) => {
    // Given: Service Workerが登録済みで、セッションCookieのリフレッシュトークンが無効で期限切れ
    await openWithServiceWorker(page);
    const cookies = (await context.cookies()).filter((cookie) =>
      /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name),
    );
    expect(cookies.length, "セッションCookieがあること").toBeGreaterThan(0);
    cookies.sort((a, b) =>
      a.name.localeCompare(b.name, "en", { numeric: true }),
    );
    const chunked = cookies.length > 1 || /\.\d+$/.test(cookies[0].name);
    const baseName = cookies[0].name.replace(/\.\d+$/, "");
    const raw = cookies.map((cookie) => cookie.value).join("");
    const prefix = "base64-";
    const json = raw.startsWith(prefix)
      ? Buffer.from(raw.slice(prefix.length), "base64url").toString("utf-8")
      : decodeURIComponent(raw);
    const session = JSON.parse(json);
    session.expires_at = Math.floor(Date.now() / 1000) - 3600;
    session.refresh_token = "invalid-refresh-token";
    const encoded = raw.startsWith(prefix)
      ? prefix + Buffer.from(JSON.stringify(session)).toString("base64url")
      : encodeURIComponent(JSON.stringify(session));
    const template = cookies[0];
    const rewritten: typeof cookies = [];
    if (chunked) {
      const size = 3180;
      for (let i = 0, n = 0; i < encoded.length; i += size, n++) {
        rewritten.push({
          ...template,
          name: `${baseName}.${n}`,
          value: encoded.slice(i, i + size),
        });
      }
    } else {
      rewritten.push({ ...template, name: baseName, value: encoded });
    }
    await context.clearCookies({ name: /^sb-.*-auth-token/ });
    await context.addCookies(rewritten);

    // When: /roundsを開く
    const response = await page.goto("/rounds");

    // Then: 枠(Service Worker由来)から/signinへ遷移する
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page).toHaveURL(/\/signin$/);
  });
});

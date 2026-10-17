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
import { expectRoundBasesFetched } from "../helpers/reference-data";
import { createRound } from "../helpers/rounds";
import { comeBackOnline, goOffline } from "../helpers/service-worker";

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

// 新しいビルドのService Workerが、プリキャッシュ対象の枠をこの目印付きで保存する。
// 遷移先が新しいビルドの枠で表示されたかを、読み込んだ文書の本文で確かめるため。
const NEW_BUILD_MARKER = '<meta name="e2e-build" content="2">';
const NEW_REVISION = "e2e-new-build";

// 新しいビルドを`NEW_SW_URL`の/sw.jsとして模す。
// 新しいビルドは、プリキャッシュ対象のリビジョンが変わり、枠に目印が入った/sw.jsとして模す。
// Playwrightは更新確認（registration.update()やナビゲーション時の確認）の取得を差し替えられないため、
// サーバーに存在しない別URLとして登録して、新しいService Workerが現れる状況を作る。
// 更新確認はサーバーへ届き404になって無視されるため、模擬の版が実際の/sw.jsに置き換わらない。
const NEW_SW_URL = "/sw-e2e-new.js";

async function routeNewBuild(page: Page, context: BrowserContext) {
  const urls = await precachedUrls(page);
  const revisions = ["/offline", ...FRAME_PATHS].map((path) => {
    const revision = urls
      .find((url) => url.includes(`${path}?__WB_REVISION__=`))
      ?.split("__WB_REVISION__=")[1];
    expect(revision, `${path}の旧リビジョン`).toBeDefined();
    return revision as string;
  });
  const oldRevision = revisions[0];
  const injectMarker = `
const e2eFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const response = await e2eFetch(input, init);
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("/__shell/")) return response;
  const html = (await response.text()).replace("<head>", "<head>" + ${JSON.stringify(NEW_BUILD_MARKER)});
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};
`;
  // 読み込み直した文書で、SerwistProviderが/sw.jsを登録し直すと、登録のスクリプトのURLが
  // 新しいビルドの模擬(NEW_SW_URL)から変わり、別の版として更新が始まる。
  // 本番では登録のURLは変わらないため、模擬の登録の後は同じURLのまま登録させる。
  await context.addInitScript((newSwUrl) => {
    const register = ServiceWorkerContainer.prototype.register;
    ServiceWorkerContainer.prototype.register = function (url, options) {
      const useNew =
        sessionStorage.getItem("e2eNewBuild") === "1" &&
        String(url) === "/sw.js";
      return register.call(this, useNew ? newSwUrl : url, options);
    };
  }, NEW_SW_URL);
  await context.route(`**${NEW_SW_URL}`, async (route) => {
    const response = await route.fetch({
      url: new URL("/sw.js", route.request().url()).href,
    });
    let body = await response.text();
    for (const revision of revisions) {
      body = body.replaceAll(revision, NEW_REVISION);
    }
    await route.fulfill({ response, body: injectMarker + body });
  });
  return oldRevision;
}

// 新しいビルドのService Workerを登録し、待機するまで待つ。
async function publishNewBuild(page: Page) {
  await waitForQuietPage(page);
  await page.evaluate(async (newSwUrl) => {
    sessionStorage.setItem("e2eNewBuild", "1");
    await navigator.serviceWorker.register(newSwUrl);
  }, NEW_SW_URL);
  await expect.poll(async () => (await workerState(page)).waiting).toBe(true);
}

type WorkerState = {
  waiting: boolean;
  activeNew: boolean;
  controlledNew: boolean;
};

async function workerState(page: Page): Promise<WorkerState> {
  return await page.evaluate(async (newSwUrl) => {
    const registration = await navigator.serviceWorker.ready;
    const isNew = (url: string | undefined) => url?.endsWith(newSwUrl) ?? false;
    return {
      waiting: isNew(registration.waiting?.scriptURL),
      activeNew: isNew(registration.active?.scriptURL),
      controlledNew: isNew(navigator.serviceWorker.controller?.scriptURL),
    };
  }, NEW_SW_URL);
}

// メインフレームが読み込んだ文書の本文を見て、新しいビルドの枠(目印付き)が表示されたかを返す。
// 読み込みの途中で打ち切られた応答の本文は返らないことがあるため、解決した本文だけで判定する。
function trackDocuments(page: Page): () => Promise<boolean> {
  let shown = false;
  page.on("response", (response) => {
    if (
      response.request().isNavigationRequest() &&
      response.frame() === page.mainFrame()
    ) {
      void response
        .text()
        .then((body) => {
          if (body.includes(NEW_BUILD_MARKER)) shown = true;
        })
        .catch(() => {});
    }
  });
  return async () => shown;
}

// 再読み込みされていないことを確かめるため、文書に目印を置く。
async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { e2eDocument: boolean }).e2eDocument = true;
  });
}

async function isSameDocument(page: Page) {
  return await page.evaluate(
    () => (window as unknown as { e2eDocument?: boolean }).e2eDocument === true,
  );
}

// 認証済みで/roundsを開き、水和を待つ。
// 未認証のまま/roundsを開くと、水和後にセッション喪失の判定が/signinへハードナビゲーションし、
// 取得済みのレスポンス本文が破棄されて読めなくなるため、認証済みにして/roundsに留まらせる。
async function openRounds(page: Page) {
  await openWithServiceWorker(page);
  await page.goto("/rounds");
  await waitForHydration(page);
}

// クライアント側の遷移(リンク)で/rounds/newへ移る。
async function transitionByLink(page: Page) {
  await page.getByTestId("new-round-fab").click();
}

// 遷移で切り替えを試み、新しいService Workerが有効になるまで待つ。
// 旧Service Workerの停止と画面のfetchが重なると有効化が進まないことがあり(design.mdの制約)、
// その遷移では切り替えず次の遷移で再び試みる。その動きに合わせ、有効にならなければ戻る遷移でもう一度試みる。
async function transitionUntilSwitched(page: Page) {
  await transitionByLink(page);
  for (let attempt = 0; attempt < 3; attempt++) {
    const switched = await expect
      .poll(
        async () => (await workerState(page).catch(() => null))?.activeNew,
        {
          timeout: 5_000,
        },
      )
      .toBe(true)
      .then(
        () => true,
        () => false,
      );
    if (switched) return;
    await page.goBack();
  }
}

// 旧ビルドの枠(新しいビルドの目印が無い文書)が、`startWatchingOldFrame`の後に描かれたかを記録する。
// 対象は、その時点より後の新しい文書と、パスが変わった後の表示で、操作前の画面は含めない。
// 文書をまたいで残すため、sessionStorageに書く。描画のたびに確かめる。
async function watchOldFrameShown(context: BrowserContext) {
  await context.addInitScript((marker) => {
    const check = () => {
      const start = JSON.parse(
        sessionStorage.getItem("e2eWatchStart") ?? "null",
      ) as { origin: number; path: string } | null;
      const isAfterStart =
        start !== null &&
        (start.origin !== performance.timeOrigin ||
          start.path !== location.pathname);
      if (document.body && isAfterStart && !document.querySelector(marker)) {
        sessionStorage.setItem("e2eOldFrameShown", "1");
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, 'meta[name="e2e-build"]');
}

// 以降に描かれる旧ビルドの枠の記録を始める。リンクを押す直前に呼ぶ。
async function startWatchingOldFrame(page: Page) {
  await page.evaluate(() => {
    sessionStorage.removeItem("e2eOldFrameShown");
    sessionStorage.setItem(
      "e2eWatchStart",
      JSON.stringify({
        origin: performance.timeOrigin,
        path: location.pathname,
      }),
    );
  });
}

async function oldFrameShown(page: Page) {
  return await page.evaluate(
    () => sessionStorage.getItem("e2eOldFrameShown") === "1",
  );
}

// 新しいビルドの版が待機していても、SKIP_WAITINGを無視する(切り替えが進まない状況)。
// 送られた回数をsessionStorageに数える。
async function swallowSkipWaiting(context: BrowserContext) {
  await context.addInitScript(() => {
    const postMessage = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (
      this: ServiceWorker,
      ...args: unknown[]
    ) {
      const message = args[0] as { type?: string } | undefined;
      if (message?.type === "SKIP_WAITING") {
        const count = Number(sessionStorage.getItem("e2eSkipWaiting") ?? "0");
        sessionStorage.setItem("e2eSkipWaiting", String(count + 1));
        return;
      }
      return (postMessage as (...a: unknown[]) => void).apply(this, args);
    };
  });
}

async function skipWaitingCount(page: Page) {
  return await page.evaluate(() =>
    Number(sessionStorage.getItem("e2eSkipWaiting") ?? "0"),
  );
}

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

// ビルド時に存在しないIDとして、ランダムなUUIDを使う(任意IDの枠を共有する証明)。
function unknownRoundPath(): string {
  return `/rounds/${randomUUID()}`;
}

test("紹介画面を開くと、ブラウザがアプリとしてインストールでき、iOSのホーム画面に追加するアイコンの画像が取得できる", async ({
  page,
  context,
}) => {
  await page.goto("/");

  // ブラウザのインストール操作そのものは自動化できないため、
  // Chromiumがアプリとして認識するか（インストール可否の判定結果）で確かめる。
  const session = await context.newCDPSession(page);
  const manifest = await session.send("Page.getAppManifest");
  expect(manifest.url).toMatch(/\/manifest\.webmanifest$/);
  const { installabilityErrors } = await session.send(
    "Page.getInstallabilityErrors",
  );
  expect(installabilityErrors).toEqual([]);
  const href = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");
  expect(href, "apple-touch-iconのlinkがあること").not.toBeNull();
  const response = await page.request.get(href as string);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("未認証で紹介画面を開くと画面の枠が保存され、サインインした後にオフラインでラウンド一覧を開くと、サインイン画面ではなく一覧の枠と「ネットワークに接続されていません」が表示され、オンラインに戻ると一覧の内容が表示される", async ({
  page,
  context,
}) => {
  // 未認証で紹介画面を開き、Service Workerが静的アセットと/offlineと画面の枠を保存したことを確かめる。
  const errors = collectHydrationErrors(page);
  await openWithServiceWorker(page);
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

  // 入力中のラウンドが端末に無い使い捨てのユーザーでサインインし、ラウンド一覧へ進む。
  await signUpAndSignIn(page, {
    email: `e2e-offline-list-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
    password: "password-e2e-offline-list",
  });

  // オフラインでラウンド一覧を開き、Service Workerが返した一覧の枠と「ネットワークに接続されていません」が表示され、サインイン画面とラウンドの無い表示が出ないことを確かめる。
  await goOffline(context);
  const response = await page.goto("/rounds");
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(
    page.getByRole("heading", { name: "ラウンド一覧" }),
  ).toBeVisible();
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
  await expect(
    page.getByText("ネットワークに接続されていません"),
  ).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);
  await expect(page.getByPlaceholder("パスワード")).toHaveCount(0);
  await expect(page.getByText("まだラウンドがありません。")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "入力中" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "過去履歴" })).toHaveCount(0);
  expect(errors, "ハイドレーションエラーがないこと").toEqual([]);

  // オンラインに戻り、一覧の内容(ラウンドが無い表示)が表示されることを確かめる。
  await comeBackOnline(context, page);
  await expect(page.getByText("まだラウンドがありません。")).toBeVisible();
  await expect(page.getByText("ネットワークに接続されていません")).toHaveCount(
    0,
  );
});

test("Service Workerが登録済みでオフラインのとき、紹介画面を開くと、オフラインのページが表示される", async ({
  page,
  context,
}) => {
  // /はプリキャッシュ対象外のため、
  // ナビゲーションの失敗を認証に依存しない静的な/offlineで受け止める。
  await openWithServiceWorker(page);
  await context.setOffline(true);

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "オフラインです" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "インターネットに接続されていません。接続を確認してから、もう一度お試しください。",
    ),
  ).toBeVisible();
});

test("オフラインのページでAIMSロゴを押すと、紹介画面へ移動する", async ({
  page,
}) => {
  // ロゴのリンクは通信の有無によらず同じため、オンラインで/offlineを直接開いて押す。
  // オフラインで紹介画面を開いて表示したページはURLが/のままで、押しても遷移先のURLを確かめられないため。
  await page.goto("/offline");

  await page.getByRole("link", { name: "AIMS" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
});

test("Service Workerが登録済みで未認証のとき、ラウンドの詳細を開くと、Service Workerが返した枠からサインイン画面へ移動する", async ({
  page,
}) => {
  await openWithServiceWorker(page);

  const response = await page.goto(unknownRoundPath());

  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page).toHaveURL(/\/signin(\?|$)/);
});

test.describe("認証済みで開く", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("ラウンドの詳細を開くと、Service Workerが返した枠に読み込み中が表示された後に、ラウンドの内容が表示される", async ({
    page,
    context,
  }) => {
    const roundId = await createRound({
      email: getSharedEmail(),
      password: SHARED_PASSWORD,
      name: "枠の確認",
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    });
    const errors = collectHydrationErrors(page);
    await openWithServiceWorker(page);
    // 枠が内容より先に表示されることを確かめるため、ラウンドの取得を保留する。
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route("**/rest/v1/rounds?*", async (route) => {
      await gate;
      await route.continue();
    });

    const response = await page.goto(`/rounds/${roundId}`, {
      waitUntil: "commit",
    });

    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByTestId("round-config-summary")).toHaveCount(0);
    release();
    await expect(page.getByTestId("round-config-summary")).toBeVisible();
    expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
  });

  test("プリセットを端末に保存していないとき、オフラインでラウンドの作成を開くと、枠と「ネットワークに接続されていません」が表示され、オンラインに戻るとプリセット一覧が表示される", async ({
    page,
    context,
  }) => {
    // オフラインでラウンドの作成を開き、Service Workerが返した枠と「ネットワークに接続されていません」を確かめる。
    const errors = collectHydrationErrors(page);
    await openWithServiceWorker(page);
    await goOffline(context);
    const response = await page.goto("/rounds/new");
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(
      page.getByRole("heading", { name: "ラウンドを作成" }),
    ).toBeVisible();
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toBeVisible();
    expect(errors, "ハイドレーションエラーがないこと").toEqual([]);

    // オンラインに戻り、プリセット一覧が表示されることを確かめる。
    await comeBackOnline(context, page);
    await expect(page.getByTestId("round-preset-button").first()).toBeVisible();
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toHaveCount(0);
  });

  test("端末にオフラインで開ける内容がないラウンドを、オフラインで開くと、詳細の枠と「ネットワークに接続されていません」が表示され、オンラインに戻るとラウンドの内容が表示される", async ({
    page,
    context,
  }) => {
    // 端末が最後に取得した後に作ったラウンドを、オフラインで開き、Service Workerが返した詳細の枠と「ネットワークに接続されていません」を確かめる。
    const errors = collectHydrationErrors(page);
    await openWithServiceWorker(page);
    // 作るラウンドが端末の一括の取得に入らないよう、最初の一括の取得が済んでから作る。
    await expectRoundBasesFetched(page);
    const roundId = await createRound({
      email: getSharedEmail(),
      password: SHARED_PASSWORD,
      name: "復帰の確認詳細",
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    });
    await goOffline(context);
    const response = await page.goto(`/rounds/${roundId}`);
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toBeVisible();
    expect(errors, "ハイドレーションエラーがないこと").toEqual([]);

    // オンラインに戻り、ラウンドの内容が表示されることを確かめる。
    await comeBackOnline(context, page);
    await expect(page.getByTestId("round-config-summary")).toBeVisible();
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toHaveCount(0);
  });
});

test.describe("新しいビルドへの更新", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("新しいビルドが公開されると、新しいService Workerが待機して表示中の画面は読み込み直されず、リンクを押して他の画面へ移ると、旧ビルドの枠を挟まずに新しいビルドの枠で表示される", async ({
    page,
    context,
  }) => {
    await watchOldFrameShown(context);
    await openRounds(page);
    const oldRevision = await routeNewBuild(page, context);
    const shownNewBuild = trackDocuments(page);
    await markDocument(page);
    await publishNewBuild(page);
    expect(await workerState(page)).toEqual({
      waiting: true,
      activeNew: false,
      controlledNew: false,
    });
    // 待機した版がひとりでに有効にならないことを確かめるため、時間を置く。
    await page.waitForTimeout(2_000);
    expect((await workerState(page)).activeNew).toBe(false);
    expect(await isSameDocument(page)).toBe(true);
    await expect(
      page.getByRole("heading", { name: "ラウンド一覧" }),
    ).toBeVisible();

    // リンクを押してラウンド作成画面へ移り、旧ビルドの枠を挟まずに新しいビルドの枠で表示されることを確かめる。
    await startWatchingOldFrame(page);
    await transitionByLink(page);
    await expect.poll(shownNewBuild, { timeout: 15_000 }).toBe(true);
    await expect(page.locator('meta[name="e2e-build"]')).toHaveCount(1);
    await expect(page.getByTestId("round-start-button")).toBeVisible();
    expect(await oldFrameShown(page)).toBe(false);
    // 読み込み直した文書の登録の確認が、同じ模擬のURLの版を再び待機させることがあるため、待機の有無は問わない。
    await expect
      .poll(
        async () => {
          const { activeNew, controlledNew } = await workerState(page);
          return { activeNew, controlledNew };
        },
        { timeout: 10_000 },
      )
      .toEqual({ activeNew: true, controlledNew: true });
    // 旧リビジョンの削除は有効化の後に非同期で行われるため、待って確かめる。
    await expect
      .poll(async () => {
        const urls = await precachedUrls(page);
        return {
          hasNew: urls.some((url) => url.endsWith(`=${NEW_REVISION}`)),
          hasOld: urls.some((url) => url.endsWith(`=${oldRevision}`)),
        };
      })
      .toEqual({ hasNew: true, hasOld: false });
  });

  test("オフラインのとき、新しいService Workerが待機している状態でリンクを押して他の画面へ移ると、新しいビルドの枠で表示される", async ({
    page,
    context,
  }) => {
    await openRounds(page);
    await routeNewBuild(page, context);
    const shownNewBuild = trackDocuments(page);
    await publishNewBuild(page);

    // オフラインにしてリンクを押し、移った先の画面が新しいビルドの枠で表示されることを確かめる。
    await context.unroute(`**${NEW_SW_URL}`);
    await goOffline(context);
    await transitionUntilSwitched(page);
    await expect.poll(shownNewBuild, { timeout: 15_000 }).toBe(true);
    await expect(page).toHaveURL(/\/rounds(\/new)?$/);
    await expect(
      page.getByText("ネットワークに接続されていません"),
    ).toBeVisible();
  });

  test("新しいService Workerへの切り替えが進まないとき、リンクを押して他の画面へ移ると、旧ビルドの枠で表示されて操作でき、次にリンクを押したときに改めて切り替えを試みる", async ({
    page,
    context,
  }) => {
    await swallowSkipWaiting(context);
    await openRounds(page);
    await routeNewBuild(page, context);
    await publishNewBuild(page);

    // リンクを押してラウンド作成画面へ移り、旧ビルドの枠で表示されて操作でき、切り替えの合図が1回だけ送られたことを確かめる。
    await transitionByLink(page);
    await expect(page).toHaveURL(/\/rounds\/new$/, { timeout: 10_000 });
    await expect(page.getByTestId("round-start-button")).toBeVisible();
    await expect(page.locator('meta[name="e2e-build"]')).toHaveCount(0);
    expect(await skipWaitingCount(page)).toBe(1);
    expect((await workerState(page)).waiting).toBe(true);

    // ブラウザの戻るで、ラウンド一覧へ戻る。
    await page.goBack();
    await expect(page).toHaveURL(/\/rounds$/);

    // もう一度リンクを押してラウンド作成画面へ移り、その移動で再び切り替えの合図が送られることを確かめる。
    await transitionByLink(page);
    await expect(page).toHaveURL(/\/rounds\/new$/, { timeout: 10_000 });
    expect(await skipWaitingCount(page)).toBe(2);
  });
});

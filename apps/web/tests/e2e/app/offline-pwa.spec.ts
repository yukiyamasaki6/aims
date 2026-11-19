import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { FRAME_PATHS, shellUrlOf } from "@/routes";
import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH, signUpAndSignIn } from "../helpers/auth";
import { collectHydrationErrors } from "../helpers/hydration";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { homeHeading } from "../helpers/settings";

const authText = translatorFor("auth");
const offlinePwaText = translatorFor("offlinePwa");
const roundsText = translatorFor("rounds");

// 認証に依存しない/を使い、Service Workerが有効になるまで待つ。
async function openWithServiceWorker(page: Page) {
  await page.goto("/");
  // 初回の読み込みと登録処理が落ち着く前に別のService Workerを登録すると、
  // 新しいService Workerが待機したままになることがあるため、通信の完了を待つ。
  await page.waitForLoadState("networkidle");
  // 有効化直後のclients.claim()でページが制御されるまで待つ。/には水和の完了を表す要素がない。
  await waitForServiceWorkerControl(page, { waitForHydration: false });
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
const SHELL_URLS = FRAME_PATHS.map(shellUrlOf);

test("未認証で紹介画面を開くと画面の枠が保存され、サインインした後にオフラインでホームと履歴を開くと、サインイン画面ではなくそれぞれの枠が表示され、ホームには入力中のラウンドがない旨、履歴には「ネットワークに接続されていません」が表示される", async ({
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
  expect(urls.some((url) => url.endsWith(".woff2"))).toBe(true);
  for (const frame of SHELL_URLS) {
    expect(
      urls.some((url) => url.includes(`${frame}?__WB_REVISION__=`)),
      `${frame}がプリキャッシュにあること`,
    ).toBe(true);
  }

  // 保存された枠の本文に、サインイン画面にだけある見出しと入力欄がないこと(/signinのHTMLが枠として保存されていないこと)。
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
  }, SHELL_URLS);
  for (const frame of SHELL_URLS) {
    const body = frameBodies[frame];
    expect(body, `${frame}の本文`).toBeTruthy();
    expect(body, `${frame}にサインインの見出しがないこと`).not.toContain(
      `>${authText("signInTitle")}</h1>`,
    );
    expect(body, `${frame}にパスワード入力欄がないこと`).not.toContain(
      'placeholder="パスワード"',
    );
  }
  expect(frameBodies["/__shell/rounds"], "ホームの枠の本文").toContain(
    roundsText("newRoundLabel"),
  );

  // 入力中のラウンドが端末に無い使い捨てのユーザーでサインインし、ホームへ進む。
  await signUpAndSignIn(page, {
    email: `e2e-offline-list-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
    password: "password-e2e-offline-list",
  });

  // オフラインでホームを開き、Service Workerが返したホームの枠と入力中のラウンドがない旨が表示され、サインイン画面と取得の失敗の表示が出ないことを確かめる。
  await goOffline(context);
  const response = await page.goto("/rounds");
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(homeHeading(page)).toBeVisible();
  await expect(page.getByText(roundsText("homeEmpty"))).toBeVisible();
  await expect(page.getByText(roundsText("fetchOffline"))).toHaveCount(0);
  await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);
  await expect(page.getByPlaceholder(authText("emailPlaceholder"))).toHaveCount(
    0,
  );
  expect(errors, "ハイドレーションエラーがないこと").toEqual([]);

  // オフラインで履歴を開き、Service Workerが返した履歴の枠と「ネットワークに接続されていません」が表示され、サインイン画面とラウンドの無い表示が出ないことを確かめる。
  const historyResponse = await page.goto("/rounds/history");
  expect(historyResponse?.fromServiceWorker()).toBe(true);
  await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
  await expect(page.getByText(roundsText("fetchOffline"))).toBeVisible();
  await expect(page.getByText(roundsText("historyEmpty"))).toHaveCount(0);
  await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);
  expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
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
    page.getByRole("heading", { name: offlinePwaText("offlineTitle") }),
  ).toBeVisible();
  await expect(
    page.getByText(offlinePwaText("offlineDescription")),
  ).toBeVisible();
});

test.describe("認証済みで開く", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

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
    await expect(page.getByTestId("round-start-button")).toBeVisible();
    await expect(page.getByText(roundsText("fetchOffline"))).toBeVisible();
    expect(errors, "ハイドレーションエラーがないこと").toEqual([]);

    // オンラインに戻り、プリセット一覧が表示されることを確かめる。
    await comeBackOnline(context, page);
    await expect(page.getByTestId("round-preset-button").first()).toBeVisible();
    await expect(page.getByText(roundsText("fetchOffline"))).toHaveCount(0);
  });
});

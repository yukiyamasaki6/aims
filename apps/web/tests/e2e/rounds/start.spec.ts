import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { savedRoundCount } from "../helpers/other-device";
import { createPreset } from "../helpers/presets";
import {
  openNewRoundThenGoOffline,
  saveTargetFacesOnDevice,
  startRoundOffline,
} from "../helpers/reference-data";
import { signInAsTestUser } from "../helpers/rounds";
import {
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { overlapNextRefresh } from "../helpers/session-overlap";
import { mockTurnstile } from "../helpers/turnstile";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;

async function openNewRound(page: Page) {
  await page.goto("/rounds/new");
  await waitForHydration(page);
}

function presetButton(page: Page, name: string) {
  return page.getByTestId("round-preset-button").filter({ hasText: name });
}

// 名前ボタンとメニューを囲む行の親が、選択時に展開される距離構成まで含むカード。
function presetCard(page: Page, name: string) {
  return presetButton(page, name).locator("../..");
}

test("start-01: 認証済みのとき、/rounds/newを開くと、個人プリセットと公式プリセットの一覧が表示される", async ({
  page,
}) => {
  // Given: 認証済み
  // When: /rounds/newを開く
  await openNewRound(page);

  // Then: 個人プリセットと公式プリセットを表示する
  await expect(page.getByText("個人プリセット", { exact: true })).toBeVisible();
  await expect(page.getByText("公式プリセット", { exact: true })).toBeVisible();
  await expect(presetButton(page, "WA 1440")).toBeVisible();
});

test("start-04: 「一覧へ戻る」リンクをクリックすると、/roundsへ遷移する", async ({
  page,
}) => {
  // Given: ラウンド作成画面
  await openNewRound(page);

  // When: 「一覧へ戻る」リンクをクリックする
  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  // Then: /roundsへ遷移する
  await expect(page).toHaveURL(/\/rounds$/);
});

test("start-05: プリセットが未選択のとき、プリセットをクリックすると、クリックしたプリセットが選択され、開始ボタンに選択中のプリセット名が表示され、選択中のプリセットの距離構成が展開表示される", async ({
  page,
}) => {
  // Given: プリセットが未選択
  await openNewRound(page);

  // When: プリセットをクリックする
  await presetButton(page, "WA 1440").click();

  // Then: クリックしたプリセットを選択中にし、開始ボタンにプリセット名を表示し、距離構成を展開表示する
  await expect(presetButton(page, "WA 1440")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("round-start-button")).toHaveText(
    "「WA 1440」で開始",
  );
  const card = presetCard(page, "WA 1440");
  await expect(card).toContainText("90m");
  await expect(card.locator('[role="img"]')).toHaveCount(4);
});

test("start-08: プリセットが未選択のとき、開始ボタンをクリックすると、空の距離構成のラウンドが作成される、そのラウンドが保存される", async ({
  page,
}) => {
  // Given: プリセットが未選択
  await openNewRound(page);

  // When: 開始ボタンをクリックする
  await page.getByTestId("round-start-button").click();

  // Then: 距離を持たないラウンドを作成し、保存する
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
  await expect(page.getByTestId("distance-summary-1")).toHaveCount(0);
  const id = page.url().split("/").pop() as string;
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  await expect
    .poll(() => savedRoundCount(supabase, id), { timeout: 15_000 })
    .toBe(1);
});

test("start-09: プリセットが選択されているとき、開始ボタンをクリックすると、プリセットの距離構成のラウンドが作成される", async ({
  page,
}) => {
  // Given: プリセットが選択されている
  await openNewRound(page);
  await presetButton(page, "WA 1440").click();

  // When: 開始ボタンをクリックする
  await page.getByTestId("round-start-button").click();

  // Then: プリセットの距離構成でラウンドを作成する
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("distance-summary-1")).toContainText("90m");
  await expect(page.getByTestId("distance-summary-2")).toContainText("70m");
  await expect(page.getByTestId("distance-summary-3")).toContainText("50m");
  await expect(page.getByTestId("distance-summary-4")).toContainText("30m");
});

test("start-11: ラウンド作成画面で開始ボタンをクリックすると、/rounds/[id]へ遷移する", async ({
  page,
}) => {
  // Given: ラウンド作成画面
  await openNewRound(page);

  // When: 開始ボタンをクリックする
  await page.getByTestId("round-start-button").click();

  // Then: /rounds/[id]へ遷移する
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
});

test("start-13: 未認証のとき、開始ボタンをクリックすると、エラーメッセージが表示される", async ({
  page,
}) => {
  // Given: ラウンド作成画面を開いた後で、サインインが切れる
  await openNewRound(page);
  // 取得の完了を待ち、サインイン切れが開始ボタンの操作だけに影響する状態にする。
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  await page.context().clearCookies();

  // When: 開始ボタンをクリックする
  await page.getByTestId("round-start-button").click();

  // Then: エラーメッセージを表示し、遷移しない
  await expect(page.getByText("サインインが必要です。")).toBeVisible();
  await expect(page).toHaveURL(/\/rounds\/new$/);
});

test("start-17: 的の一覧を端末に保存済みで、オフラインのラウンド作成画面のとき、開始ボタンをクリックすると、/rounds/[id]へ遷移し、ラウンドが表示される", async ({
  page,
}) => {
  // Given: 的の一覧を端末に保存済みで、オフラインのラウンド作成画面
  await saveTargetFacesOnDevice(page);
  await openNewRound(page);
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());

  // When: 開始ボタンをクリックする
  await page.getByTestId("round-start-button").click();

  // Then: /rounds/[id]へ遷移し、ラウンドを表示する
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await waitForHydration(page);
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
});

test("start-18: 的の一覧を端末に保存済みで、ラウンド作成画面で認証を確認できない(通信できない)とき、開始ボタンをクリックすると、/rounds/[id]へ遷移し、ラウンドが表示される", async ({
  page,
}) => {
  // Given: 的の一覧を端末に保存済みで、アクセストークンが失効し、更新の通信ができない
  await saveTargetFacesOnDevice(page);
  await page.clock.install();
  await openNewRound(page);
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  await page.route("**/auth/v1/token*", (route) => route.abort());
  await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

  // When: 開始ボタンをクリックする
  await page.getByTestId("round-start-button").click();

  // Then: /rounds/[id]へ遷移し、ラウンドを表示する
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
});

const PRESET_ROUNDS_REST = "**/rest/v1/preset_rounds?*";

test("start-15: ラウンド作成画面でプリセットを端末に保存しておらず、取得できない(通信できない)とき、/rounds/newを開くと、「一覧へ戻る」リンクと開始ボタンが表示され、「読み込めませんでした。」と再試行ボタンが表示され、プリセット無しで開始できる", async ({
  page,
}) => {
  // Given: プリセットを端末に保存しておらず、取得が通信できない
  await page.route(PRESET_ROUNDS_REST, (route) => route.abort("failed"));

  // When: /rounds/newを開く
  await openNewRound(page);

  // Then: 枠と「読み込めませんでした。」と再試行ボタンを表示し、プリセット無しで開始できる
  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
  await expect(page.getByTestId("round-start-button")).toBeVisible();
  await expect(page.getByText("読み込めませんでした。")).toBeVisible();
  await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
});

test("start-16: ラウンド作成画面でプリセットを端末に保存しておらず、取得がエラーになるとき、/rounds/newを開くと、エラーメッセージが表示され、プリセット無しで開始できる", async ({
  page,
}) => {
  // Given: プリセットを端末に保存しておらず、取得がエラーになる
  // 取得エラー表示の代表として、サーバーエラー(500)で確かめる。他のエラー種別は単体テストで確かめる。
  await page.route(PRESET_ROUNDS_REST, (route) =>
    route.fulfill({ status: 500, body: "temporary error" }),
  );

  // When: /rounds/newを開く
  await openNewRound(page);

  // Then: エラーメッセージを表示し、プリセット無しで開始できる
  // Next.jsのroute announcerも role="alert" を持つため、メッセージで絞る。
  await expect(
    page.getByRole("alert").filter({ hasText: "読み込めませんでした。" }),
  ).toBeVisible();
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
});

// セッションの更新はリフレッシュトークンを入れ替え、共有のユーザーの他のテストのセッションを無効にし得るため、使い捨てのユーザーで行う。
test.describe("セッションの更新の重なり", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("start-23: ラウンド作成画面で、セッションの更新が別の書き手の更新と重なるとき、開始ボタンをクリックすると、/rounds/[id]へ遷移し、ラウンドが表示される", async ({
    page,
  }) => {
    // Given: ラウンド作成画面を開いた後で、セッションの期限が来ていて、ブラウザの更新が別の書き手の更新と重なる
    await signUpAndSignIn(page, {
      email: `e2e-start-overlap-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`,
      password: "password-e2e-start",
    });
    await openNewRound(page);
    // 取得の完了を待ち、セッションの更新が開始ボタンの操作だけに重なる状態にする。
    await expect(presetButton(page, "WA 1440")).toBeVisible();
    const { overlapped } = await overlapNextRefresh(page);

    // When: 開始ボタンをクリックする
    await page.getByTestId("round-start-button").click();

    // Then: /rounds/[id]へ遷移し、ラウンドが表示される
    await overlapped;
    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
    await expect(page.getByTestId("round-summary")).toContainText("合計0");
    await expect(page.getByText("サインインが必要です。")).toHaveCount(0);
  });
});

// 共有ユーザーの個人プリセットは全テストで共有されるため、名前はテストごとに一意にする。
let sequence = 0;
function uniqueName(label: string): string {
  sequence++;
  return `${label}-${Date.now()}-${sequence}`;
}

async function createPersonalPreset(name: string) {
  await createPreset({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
}

test("start-19: /rounds/newをオンラインで一度表示した後にオフラインのとき、/rounds/newを開くと、個人プリセットと公式プリセットの一覧が表示され、「ネットワークに接続されていません」が表示されない", async ({
  page,
}) => {
  // Given: /rounds/newをオンラインで一度表示した後にオフライン
  const name = uniqueName("保存済み");
  await createPersonalPreset(name);
  await openNewRound(page);
  await expect(presetButton(page, name)).toBeVisible();
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());

  // When: /rounds/newを開く
  await page.goto("/rounds/new");

  // Then: 個人プリセットと公式プリセットの一覧を表示し、「ネットワークに接続されていません」を表示しない
  await expect(presetButton(page, name)).toBeVisible();
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  await expect(page.getByText("個人プリセット", { exact: true })).toBeVisible();
  await expect(page.getByText("公式プリセット", { exact: true })).toBeVisible();
  await expect(page.getByText("ネットワークに接続されていません")).toHaveCount(
    0,
  );
});

test("start-20: /rounds/newをオンラインで一度表示した後にオフラインで、プリセットが選択されているとき、開始ボタンをクリックすると、プリセットの距離構成のラウンドが作成される", async ({
  page,
}) => {
  // Given: /rounds/newをオンラインで一度表示した後にオフラインで、プリセットが選択されている
  await openNewRoundThenGoOffline(page);
  await page.goto("/rounds/new");
  await presetButton(page, "WA 1440").click();

  // When: 開始ボタンをクリックする
  await startRoundOffline(page);

  // Then: プリセットの距離構成でラウンドを作成する
  await expect(page.getByTestId("distance-summary-1")).toContainText("90m");
  await expect(page.getByTestId("distance-summary-2")).toContainText("70m");
  await expect(page.getByTestId("distance-summary-3")).toContainText("50m");
  await expect(page.getByTestId("distance-summary-4")).toContainText("30m");
});

test("start-21: 端末に保存済みのプリセットがサーバーで削除された後、オンラインのとき、/rounds/newを開くと、削除されたプリセットが表示されない", async ({
  page,
}) => {
  // Given: 端末に保存済みのプリセットがサーバーで削除された
  const name = uniqueName("削除される");
  const presetId = await createPreset({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await openNewRound(page);
  await expect(presetButton(page, name)).toBeVisible();
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  const { error } = await supabase
    .from("preset_rounds")
    .delete()
    .eq("id", presetId);
  expect(error).toBeNull();

  // When: /rounds/newを開く
  await openNewRound(page);

  // Then: 削除されたプリセットが表示されない
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  await expect(presetButton(page, name)).toHaveCount(0);
});

test("start-22: 別のユーザーが/rounds/newを表示した後に、サインインし直してオフラインのとき、/rounds/newを開くと、前のユーザーの個人プリセットが表示されない", async ({
  browser,
}) => {
  // Given: ユーザーAが/rounds/newを表示した後に、ユーザーBでサインインし直してオフライン
  const userA = {
    email: `start22-a-${randomUUID()}@example.com`,
    password: "password-e2e-a",
  };
  const userB = {
    email: `start22-b-${randomUUID()}@example.com`,
    password: "password-e2e-b",
  };
  const name = uniqueName("ユーザーA");
  await createConfirmedUser(userA);
  await createPreset({
    ...userA,
    name,
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await mockTurnstile(page);
  await signUpAndSignIn(page, userA);
  await openNewRound(page);
  await expect(presetButton(page, name)).toBeVisible();
  await page.goto("/rounds");
  await page.getByRole("button", { name: "サインアウト" }).click();
  await page.getByRole("button", { name: "サインアウトする" }).click();
  await expect(page).toHaveURL(/\/signin/);
  await signUpAndSignIn(page, userB);
  await expect(page).toHaveURL(/\/rounds/);
  await openNewRound(page);
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  await waitForServiceWorkerControl(page);
  await goOffline(context);

  // When: /rounds/newを開く
  await page.goto("/rounds/new");

  // Then: 前のユーザーの個人プリセットが表示されない
  await expect(
    page.getByRole("heading", { name: "ラウンドを作成" }),
  ).toBeVisible();
  await expect(presetButton(page, name)).toHaveCount(0);
  await context.close();
});

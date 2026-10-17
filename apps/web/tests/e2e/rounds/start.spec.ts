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

const PRESET_ROUNDS_REST = "**/rest/v1/preset_rounds?*";

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
    distances: [{ distance: 30, totalEnds: 6, arrowsPerEnd: 6 }],
  });
}

test("個人プリセットと公式プリセットの一覧から公式プリセットを選んで開始すると、その距離構成のラウンドが表示される", async ({
  page,
}) => {
  // 一覧から公式プリセットを選び、距離構成を展開する。
  await openNewRound(page);
  await expect(page.getByText("個人プリセット", { exact: true })).toBeVisible();
  await expect(page.getByText("公式プリセット", { exact: true })).toBeVisible();
  await presetButton(page, "WA 1440").click();
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

  // 選んだプリセットで開始し、ラウンドの画面へ進む。
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("distance-summary-1")).toContainText("90m");
  await expect(page.getByTestId("distance-summary-2")).toContainText("70m");
  await expect(page.getByTestId("distance-summary-3")).toContainText("50m");
  await expect(page.getByTestId("distance-summary-4")).toContainText("30m");
});

test("プリセットを選ばずに開始すると、距離のないラウンドが表示され、サーバーに保存される", async ({
  page,
}) => {
  await openNewRound(page);

  await page.getByTestId("round-start-button").click();

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

test("「一覧へ戻る」リンクを押すと、ラウンド一覧へ移動する", async ({
  page,
}) => {
  await openNewRound(page);

  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});

test("的の一覧を端末に保存済みなら、オフラインでも開始して、ラウンドが表示される", async ({
  page,
}) => {
  await saveTargetFacesOnDevice(page);
  await openNewRound(page);
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());

  await page.getByTestId("round-start-button").click();

  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await waitForHydration(page);
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
});

test("的の一覧を端末に保存済みなら、アクセストークンを更新できないときも開始して、ラウンドが表示される", async ({
  page,
}) => {
  await saveTargetFacesOnDevice(page);
  await page.clock.install();
  await openNewRound(page);
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  // 時計を進めてアクセストークンを失効させ、更新の通信を止めて、認証を確認できない状態にする。
  await page.route("**/auth/v1/token*", (route) => route.abort());
  await page.clock.fastForward(PAST_JWT_EXPIRY_MS);

  await page.getByTestId("round-start-button").click();

  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
});

// セッションの更新はリフレッシュトークンを入れ替え、共有のユーザーの他のテストのセッションを無効にし得るため、使い捨てのユーザーで行う。
test.describe("セッションの更新の重なり", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("セッションの更新が別の書き手の更新と重なっても、開始して、ラウンドが表示される", async ({
    page,
  }) => {
    await signUpAndSignIn(page, {
      email: `e2e-start-overlap-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`,
      password: "password-e2e-start",
    });
    await openNewRound(page);
    // 取得の完了を待ち、セッションの更新が開始ボタンの操作だけに重なる状態にする。
    await expect(presetButton(page, "WA 1440")).toBeVisible();
    const { overlapped } = await overlapNextRefresh(page);

    await page.getByTestId("round-start-button").click();

    await overlapped;
    await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
    await expect(page.getByTestId("round-summary")).toContainText("合計0");
    await expect(page.getByText("サインインが必要です。")).toHaveCount(0);
  });
});

test("オンラインで一度開いた後のオフラインでも、保存済みのプリセットの一覧が表示され、選んで開始すると、その距離構成のラウンドが表示される", async ({
  page,
}) => {
  // オンラインで一度開いてプリセットを端末に保存させ、オフラインで開き直して公式プリセットを選ぶ。
  const name = uniqueName("保存済み");
  await createPersonalPreset(name);
  await openNewRoundThenGoOffline(page);
  await page.goto("/rounds/new");
  await expect(presetButton(page, name)).toBeVisible();
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  await expect(page.getByText("個人プリセット", { exact: true })).toBeVisible();
  await expect(page.getByText("公式プリセット", { exact: true })).toBeVisible();
  await expect(page.getByText("ネットワークに接続されていません")).toHaveCount(
    0,
  );
  await presetButton(page, "WA 1440").click();
  await expect(presetButton(page, "WA 1440")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // 選んだプリセットで開始し、ラウンドの画面へ進む。
  await startRoundOffline(page);
  await expect(page.getByTestId("distance-summary-1")).toContainText("90m");
  await expect(page.getByTestId("distance-summary-2")).toContainText("70m");
  await expect(page.getByTestId("distance-summary-3")).toContainText("50m");
  await expect(page.getByTestId("distance-summary-4")).toContainText("30m");
});

test("別のユーザーでサインインし直した後のオフラインでは、前のユーザーの個人プリセットが表示されない", async ({
  browser,
}) => {
  // ユーザーAで開いて個人プリセットを端末に保存させ、サインアウトしてサインイン画面へ進む。
  const userA = {
    email: `e2e-start-user-a-${randomUUID()}@example.com`,
    password: "password-e2e-a",
  };
  const userB = {
    email: `e2e-start-user-b-${randomUUID()}@example.com`,
    password: "password-e2e-b",
  };
  const name = uniqueName("ユーザーA");
  await createConfirmedUser(userA);
  await createPreset({
    ...userA,
    name,
    distances: [{ distance: 30, totalEnds: 6, arrowsPerEnd: 6 }],
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

  // ユーザーBでサインインし、ラウンド一覧へ進む。
  await signUpAndSignIn(page, userB);
  await expect(page).toHaveURL(/\/rounds/);

  // ユーザーBで一度開いてから、オフラインで開き直す。
  await openNewRound(page);
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  await waitForServiceWorkerControl(page);
  await goOffline(context);
  await page.goto("/rounds/new");
  await expect(
    page.getByRole("heading", { name: "ラウンドを作成" }),
  ).toBeVisible();
  await expect(presetButton(page, name)).toHaveCount(0);
  await context.close();
});

test("サインインが切れた後に開始すると、サインインが必要なエラーが表示され、ラウンドの画面へ進まない", async ({
  page,
}) => {
  await openNewRound(page);
  // 取得の完了を待ち、サインイン切れが開始ボタンの操作だけに影響する状態にする。
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  await page.context().clearCookies();

  await page.getByTestId("round-start-button").click();

  await expect(page.getByText("サインインが必要です。")).toBeVisible();
  await expect(page).toHaveURL(/\/rounds\/new$/);
});

test("プリセットを取得できない(通信できない)ときも、「読み込めませんでした。」と再試行が表示され、プリセット無しで開始できる", async ({
  page,
}) => {
  await page.route(PRESET_ROUNDS_REST, (route) => route.abort("failed"));

  await openNewRound(page);

  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
  await expect(page.getByTestId("round-start-button")).toBeVisible();
  await expect(page.getByText("読み込めませんでした。")).toBeVisible();
  await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
});

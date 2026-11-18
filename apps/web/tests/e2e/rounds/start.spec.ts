import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signOutFromSettings,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { savedRoundCount } from "../helpers/other-device";
import { createPreset } from "../helpers/presets";
import { saveTargetFacesOnDevice } from "../helpers/reference-data";
import { signInAsTestUser } from "../helpers/rounds";
import {
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { mockTurnstile } from "../helpers/turnstile";

const roundsText = translatorFor("rounds");

test.use({ storageState: SHARED_AUTH_STATE_PATH });

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

test("個人プリセットと公式プリセットの一覧から公式プリセットを選んで開始すると、その距離構成のラウンドが表示される", async ({
  page,
}) => {
  // 一覧から公式プリセットを選び、距離構成を展開する。
  await openNewRound(page);
  await expect(
    page.getByText(roundsText("presetPersonal"), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(roundsText("presetGlobal"), { exact: true }),
  ).toBeVisible();
  await presetButton(page, "WA 1440").click();
  await expect(presetButton(page, "WA 1440")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("round-start-button")).toHaveText(
    roundsText("startWithPreset", { name: "WA 1440" }),
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
  await expect(page.getByTestId("round-summary")).toContainText(
    roundsText("roundTotal", { total: "0" }),
  );
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

  await page.getByRole("link", { name: roundsText("back") }).click();

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
  await expect(page.getByTestId("round-summary")).toContainText(
    roundsText("roundTotal", { total: "0" }),
  );
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
  await signOutFromSettings(page);

  // ユーザーBでサインインし、ラウンド一覧へ進む。
  await signUpAndSignIn(page, userB);
  await expect(page).toHaveURL(/\/rounds/);

  // ユーザーBで一度開いてから、オフラインで開き直す。
  await openNewRound(page);
  await expect(presetButton(page, "WA 1440")).toBeVisible();
  await waitForServiceWorkerControl(page);
  await goOffline(context);
  await page.goto("/rounds/new");
  await expect(page.getByTestId("round-start-button")).toBeVisible();
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

  await expect(
    page.getByText(roundsText("roundStartUnauthenticated")),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/rounds\/new$/);
});

test("プリセットを取得できない(通信できない)ときも、「読み込めませんでした。」と再試行が表示され、プリセット無しで開始できる", async ({
  page,
}) => {
  await page.route(PRESET_ROUNDS_REST, (route) => route.abort("failed"));

  await openNewRound(page);

  await expect(
    page.getByRole("link", { name: roundsText("back") }),
  ).toBeVisible();
  await expect(page.getByTestId("round-start-button")).toBeVisible();
  await expect(page.getByText(roundsText("fetchFailure.failed"))).toBeVisible();
  await expect(
    page.getByRole("button", { name: roundsText("fetchRetry") }),
  ).toBeVisible();
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
});

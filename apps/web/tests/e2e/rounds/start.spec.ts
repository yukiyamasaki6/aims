import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH, waitForHydration } from "../helpers/auth";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const CREATE_ROUND_RPC = "**/rest/v1/rpc/create_round";

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

test("start-08: プリセットが未選択のとき、開始ボタンをクリックすると、空の距離構成のラウンドが作成される", async ({
  page,
}) => {
  // Given: プリセットが未選択
  await openNewRound(page);

  // When: 開始ボタンをクリックする
  await page.getByTestId("round-start-button").click();

  // Then: 距離を持たないラウンドを作成する
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
  await expect(page.getByTestId("distance-summary-1")).toHaveCount(0);
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

test("start-10: 作成が完了していないとき、開始ボタンをクリックすると、開始ボタンが無効になる", async ({
  page,
}) => {
  // Given: create_roundの応答を保留して、作成を完了させない
  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(CREATE_ROUND_RPC, async (route) => {
    requestCount++;
    await requestGate;
    await route.continue();
  });
  await openNewRound(page);
  const startButton = page.getByTestId("round-start-button");

  // When: 開始ボタンをクリックする
  await startButton.click();

  // Then: 開始ボタンを無効にし、重ねてクリックしても作成を再送しない
  await expect(startButton).toHaveAttribute("aria-disabled", "true");
  await expect.poll(() => requestCount).toBe(1);
  await startButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
});

test("start-11: 作成が成功するとき、開始ボタンをクリックすると、/rounds/[id]へ遷移する", async ({
  page,
}) => {
  // Given: 作成が成功する
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

test("start-14: 作成が失敗するとき、開始ボタンをクリックすると、エラーメッセージが表示される", async ({
  page,
}) => {
  // Given: create_roundが失敗する
  await page.route(CREATE_ROUND_RPC, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "P0001", message: "作成に失敗しました" }),
    }),
  );
  await openNewRound(page);

  // When: 開始ボタンをクリックする
  await page.getByTestId("round-start-button").click();

  // Then: エラーメッセージを表示し、遷移しない
  await expect(page.getByText("作成に失敗しました")).toBeVisible();
  await expect(page).toHaveURL(/\/rounds\/new$/);
});

const PRESET_ROUNDS_REST = "**/rest/v1/preset_rounds?*";

test("start-15: ラウンド作成画面でプリセットを取得できないとき、/rounds/newを開くと、「一覧へ戻る」リンクと開始ボタンが表示され、「未接続」が表示され、プリセット無しで開始できる", async ({
  page,
}) => {
  // Given: プリセットの取得が通信できない
  await page.route(PRESET_ROUNDS_REST, (route) => route.abort("failed"));

  // When: /rounds/newを開く
  await openNewRound(page);

  // Then: 枠と「未接続」を表示し、プリセット無しで開始できる
  await expect(page.getByRole("link", { name: "一覧へ戻る" })).toBeVisible();
  await expect(page.getByTestId("round-start-button")).toBeVisible();
  await expect(page.getByText("未接続")).toBeVisible();
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
});

test("start-16: プリセットの取得がエラーになるとき、/rounds/newを開くと、エラーメッセージが表示され、プリセット無しで開始できる", async ({
  page,
}) => {
  // Given: プリセットの取得がエラーになる
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

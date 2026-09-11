import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test.describe(() => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証で/rounds/[id]にアクセスすると/signinにリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/rounds/00000000-0000-0000-0000-000000000000");

    await expect(page).toHaveURL(/\/signin/);
  });
});

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test("存在しない、またはアクセス権のないラウンドにアクセスすると404を表示する", async ({
  page,
}) => {
  const response = await page.goto(
    "/rounds/00000000-0000-0000-0000-000000000000",
  );

  expect(response?.status()).toBe(404);
});

test("距離が無いラウンドでは、ラウンド編集ダイアログを展開した状態で表示する", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離なしテスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await expect(page.getByTestId("round-config-save")).toBeVisible();
});

test.beforeEach(async ({ page }) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "設定パネルテスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
});

test("認証済みでラウンドを取得できると、スコアカードを表示する", async ({
  page,
}) => {
  await expect(page.getByTestId("round-config-summary")).toBeVisible();
});

test("一覧へ戻るリンクで/roundsへ遷移する", async ({ page }) => {
  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});

test("メニューボタンをクリックするとメニューが展開する", async ({ page }) => {
  await page.getByTestId("round-menu-trigger").click();

  await expect(page.getByTestId("round-delete")).toBeVisible();
});

test("メニューの削除ボタンをクリックするとラウンド削除確認ダイアログを表示する", async ({
  page,
}) => {
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await expect(
    page.getByText(
      "このラウンドを削除しますか？記録したスコアもすべて失われます。",
    ),
  ).toBeVisible();
});

test("ラウンド削除確認ダイアログでキャンセルボタンをクリックすると閉じる", async ({
  page,
}) => {
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await page.getByTestId("confirm-dialog-cancel").click();

  await expect(page.getByTestId("confirm-dialog-cancel")).toBeHidden();
});

test("ラウンド削除確認ダイアログの背景をクリックすると閉じる", async ({
  page,
}) => {
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await page.mouse.click(5, 5);

  await expect(page.getByTestId("confirm-dialog-cancel")).toBeHidden();
});

test("確認ボタンをクリックすると削除を実行する", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/rest/v1/rounds*", async (route) => {
    if (route.request().method() === "DELETE") requestCount++;
    await route.continue();
  });

  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect.poll(() => requestCount).toBe(1);
});

test("削除が成功すると一覧へ遷移し、一覧から消える", async ({ page }) => {
  const name = `詳細削除テスト-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect(page).toHaveURL(/\/rounds$/);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeHidden();
});

test("削除リクエストの送信中は確認ボタンが無効になる", async ({ page }) => {
  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/rounds*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  const confirmButton = page.getByTestId("confirm-dialog-confirm");
  const cancelButton = page.getByTestId("confirm-dialog-cancel");
  await confirmButton.click();

  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");
  await expect(cancelButton).toHaveAttribute("aria-disabled", "true");

  // getUser()の解決を挟むため、削除リクエスト自体が実際に送信される
  // （ゲートに到達する）までのラグがある。
  await expect.poll(() => requestCount).toBe(1);

  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);

  // 背景クリックでも閉じない。
  await page.mouse.click(5, 5);
  await expect(confirmButton).toBeVisible();

  releaseRequest();
});

test("サインインが切れた状態でラウンドを削除するとメッセージが表示される", async ({
  page,
}) => {
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  await page.context().clearCookies();
  await page.getByTestId("confirm-dialog-confirm").click();

  await expect(page.getByText("サインインが必要です。")).toBeVisible();
  await expect(page).not.toHaveURL(/\/rounds$/);
});

test("送信中の操作があると「同期中…」と表示する", async ({ page }) => {
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/rpc/update_round_config", async (route) => {
    await requestGate;
    await route.continue();
  });

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("同期中テスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期中…");

  releaseRequest();
});

test("送信のリトライ待機中があると「同期保留中」と表示する", async ({
  page,
}) => {
  // 初回リクエストだけ失敗させ、指数バックオフのリトライ待機に入らせる
  // （AUTH_REQUIRED_MESSAGEと一致しないエラーのため通常のリトライ対象になる）。
  let attempt = 0;
  await page.route("**/rest/v1/rpc/update_round_config", async (route) => {
    attempt++;
    if (attempt === 1) {
      await route.fulfill({ status: 500, body: "temporary error" });
      return;
    }
    await route.continue();
  });

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("同期保留中テスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期保留中");
});

test("送信した操作の反映が完了すると「同期済み」と表示する", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("同期済みテスト");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");
});

test("ラウンド名・実施日・種別・弓種を1行で表示する", async ({ page }) => {
  const summary = page.getByTestId("round-config-summary");
  await expect(summary).toContainText(
    "設定パネルテスト / 2026-08-24 / アウトドア / リカーブ",
  );
});

test("概要をクリックするとラウンド設定編集ダイアログを表示する", async ({
  page,
}) => {
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  await page.getByTestId("round-config-summary").click();

  await expect(page.getByTestId("round-config-save")).toBeVisible();
});

test("ラウンド設定編集ダイアログで背景をクリックすると、変更を破棄してダイアログを閉じる", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("破棄されるべき名前");

  await page.mouse.click(5, 5);

  await expect(page.getByTestId("round-config-save")).toBeHidden();
  await expect(page.getByTestId("round-config-summary")).not.toContainText(
    "破棄されるべき名前",
  );

  await page.getByTestId("round-config-summary").click();
  await expect(page.getByTestId("round-config-name")).not.toHaveValue(
    "破棄されるべき名前",
  );
});

test("実施日を空にして保存しようとするとエラーになり、保存されない", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-date").fill("");
  await page.getByTestId("round-config-save").click();

  await expect(page.getByText("実施日を入力してください。")).toBeVisible();
  await expect(page.getByTestId("round-config-save")).toBeVisible();
  await expect(page.getByTestId("round-config-summary")).toContainText(
    "2026-08-24",
  );
});

test("ラウンド名が未設定のときは要約にプレースホルダーを表示せず、名前の区切りも出ない", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  const summary = page.getByTestId("round-config-summary");
  await expect(summary).toHaveText("2026-08-24 / アウトドア / リカーブ");
});

test("Unmarkedな距離が残ったままフィールド以外の種別に変更しようとするとエラーになり、変更されない", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "フィールド種別変更テスト",
    roundDate: "2026-08-24",
    format: "field",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-distance-1").fill("");
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "Unmarked",
  );

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-format-outdoor").click();
  await page.getByTestId("round-config-save").click();

  await expect(
    page.getByText(
      "Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。",
    ),
  ).toBeVisible();
  // 保存は失敗しているため、編集ポップアップは開いたままで種別もフィールドのまま。
  await expect(page.getByTestId("round-config-save")).toBeVisible();

  // ポップアップを閉じ、距離をMarkedに戻して距離を入力すれば、種別変更もできるようになる。
  await page.keyboard.press("Escape");
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-marked-1").click();
  await page.getByTestId("distance-config-distance-1").fill("18");
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByTestId("distance-config-distance-1")).toBeHidden();

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-format-outdoor").click();
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("round-config-summary")).toContainText(
    "アウトドア",
  );
});

test("ラウンド名・実施日・種別・弓種を編集して保存すると反映され、再読み込み後も保持される", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();

  await page.getByTestId("round-config-name").fill("編集後の名前");
  await page.getByTestId("round-config-date").fill("2026-08-25");
  await page.getByTestId("round-config-format-indoor").click();
  await page.getByTestId("round-config-bow-type-compound").click();
  await page.getByTestId("round-config-save").click();

  const summary = page.getByTestId("round-config-summary");
  await expect(summary).toContainText("編集後の名前");
  await expect(summary).toContainText("2026-08-25");
  await expect(summary).toContainText("インドア");
  await expect(summary).toContainText("コンパウンド");
  // 保存後は折りたたまれる
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  // 送信キューの書き込みが完了する前にreloadすると、進行中のリクエストが
  // ナビゲーションで打ち切られてしまうため、同期完了を待ってからreloadする。
  await expect(page.getByTestId("sync-status")).toHaveText("同期済み");

  await page.reload();
  const summaryAfterReload = page.getByTestId("round-config-summary");
  await expect(summaryAfterReload).toContainText("編集後の名前");
  await expect(summaryAfterReload).toContainText("2026-08-25");
  await expect(summaryAfterReload).toContainText("インドア");
  await expect(summaryAfterReload).toContainText("コンパウンド");
});

test("サインインが切れた状態でラウンド設定を保存すると、同期失敗として表示される", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("編集後の名前");

  await page.context().clearCookies();
  await page.getByTestId("round-config-save").click();

  await expect(page.getByTestId("sync-status")).toHaveText("同期失敗");
  await page.getByTestId("sync-status").click();
  await expect(page.getByText("サインインが必要です。")).toBeVisible();
});

import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

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

test("普段は要約1行表示（区切りは/）で、タップすると編集フィールドが展開する", async ({
  page,
}) => {
  const summary = page.getByTestId("round-config-summary");
  await expect(summary).toContainText(
    "設定パネルテスト / 2026-08-24 / アウトドア / リカーブ",
  );
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  await summary.click();

  await expect(page.getByTestId("round-config-save")).toBeVisible();
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

test("名前欄・実施日欄は実際のキー入力でフォーカスを保ったまま複数文字入力できる", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();

  const nameInput = page.getByTestId("round-config-name");
  await nameInput.click();
  await nameInput.fill("");
  await nameInput.pressSequentially("テスト入力");
  await expect(nameInput).toHaveValue("テスト入力");

  // date inputはセグメント単位のキー入力になり、pressSequentiallyでの結果値の
  // 検証は不安定なため、ここではクリック後にフォーカスが外れないことのみ確認する
  // （fillでの値検証は次のテストでカバーする）。
  const dateInput = page.getByTestId("round-config-date");
  await dateInput.click();
  await page.keyboard.press("9");
  await expect(dateInput).toBeFocused();
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

test("距離をMarkedに修正した直後に種別を変更しても、直前の修正の反映を待ってから判定される", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "種別変更競合テスト",
    roundDate: "2026-08-24",
    format: "field",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // まずUnmarkedへ変更する（種別変更を拒否させるための下準備）。
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-distance-1").fill("");
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "Unmarked",
  );

  // ここから、距離の更新リクエストを意図的に遅延させ、直後の種別変更が
  // その反映を待たずに（サーバー側の距離状態を見て）誤って失敗しないかを
  // 検証する。
  let releaseDistanceUpdate: () => void = () => {};
  const distanceUpdateGate = new Promise<void>((resolve) => {
    releaseDistanceUpdate = resolve;
  });
  await page.route("**/rest/v1/rpc/update_distance", async (route) => {
    await distanceUpdateGate;
    await route.continue();
  });

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-marked-1").click();
  await page.getByTestId("distance-config-distance-1").fill("18");
  await page.getByTestId("distance-config-save-1").click();

  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-format-outdoor").click();
  await page.getByTestId("round-config-save").click();

  releaseDistanceUpdate();

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

test("一覧へ戻るリンクで/roundsへ遷移する", async ({ page }) => {
  await page.getByRole("link", { name: "一覧へ戻る" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});

test("メニューからラウンドを削除すると一覧へ遷移し、一覧から消える", async ({
  page,
}) => {
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
  await confirmButton.click();

  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");

  // getUser()の解決を挟むため、削除リクエスト自体が実際に送信される
  // （ゲートに到達する）までのラグがある。
  await expect.poll(() => requestCount).toBe(1);

  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);

  releaseRequest();
});

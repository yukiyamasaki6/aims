import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../../../helpers/auth";
import { createRound } from "../../../helpers/rounds";

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

test("ラウンド名が51文字以上だと保存しようとしてもエラーになり、保存されない", async ({
  page,
}) => {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("a".repeat(51));
  await page.getByTestId("round-config-save").click();

  await expect(
    page.getByText("ラウンド名は50文字以内で入力してください。"),
  ).toBeVisible();
  await expect(page.getByTestId("round-config-save")).toBeVisible();
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

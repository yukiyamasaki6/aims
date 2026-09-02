import { expect, test } from "@playwright/test";
import {
  SHARED_AUTH_STATE_PATH,
  SHARED_EMAIL,
  SHARED_PASSWORD,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeEach(async ({ page }) => {
  const roundId = await createRound({
    email: SHARED_EMAIL,
    password: SHARED_PASSWORD,
    name: "設定パネルテスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);
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
    email: SHARED_EMAIL,
    password: SHARED_PASSWORD,
    name: "",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);

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
    email: SHARED_EMAIL,
    password: SHARED_PASSWORD,
    name: "フィールド種別変更テスト",
    roundDate: "2026-08-24",
    format: "field",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto(`/rounds/${roundId}`);

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

  await page.reload();
  const summaryAfterReload = page.getByTestId("round-config-summary");
  await expect(summaryAfterReload).toContainText("編集後の名前");
  await expect(summaryAfterReload).toContainText("2026-08-25");
  await expect(summaryAfterReload).toContainText("インドア");
  await expect(summaryAfterReload).toContainText("コンパウンド");
});

import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../../../helpers/auth";
import { createRound, FIELD_TARGET_FACE_ID } from "../../../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.beforeEach(async ({ page }) => {
  // 1距離・1エンド・2射という最小構成のラウンドを作成し、ラウンド画面に遷移する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "スコア入力テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 2 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
});

test("距離が1つのときも距離の小計が表示され、点数ボタンをタップすると更新される", async ({
  page,
}) => {
  const summary = page.getByTestId("distance-summary-1");
  await expect(summary).toContainText("18m");
  await expect(summary).toContainText("小計0");

  await page.getByTestId("score-button-X").click();

  await expect(summary).toContainText("小計10");
});

test("距離が複数あるとき、距離ごとの合計・X数・10数も表示される", async ({
  page,
}) => {
  // 2距離（18m, 30m）・各1エンド1射のラウンドを別途作成する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "複数距離テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      { distance: 30, totalEnds: 1, arrowsPerEnd: 1 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // 記録前は、両距離とも的にXリングがあり最高点数（10）が一致するため、
  // ラウンド結果にも最高点数/X数が集計表示される。
  await expect(page.getByTestId("round-top-scores")).toHaveText("10: 0 / X: 0");

  await page.getByTestId("score-button-X").click();

  await expect(page.getByTestId("shot-cell-1-1-1")).toHaveText("X");

  const firstSummary = page.getByTestId("distance-summary-1");
  await expect(firstSummary).toContainText("18m");
  await expect(firstSummary).toContainText("小計10");
  // 最高点数はXも含めた実点数で数えるため、Xを打った時点で10の数も1になる。
  await expect(page.getByTestId("distance-top-scores-1")).toHaveText(
    "10: 1 / X: 1",
  );

  const secondSummary = page.getByTestId("distance-summary-2");
  await expect(secondSummary).toContainText("30m");
  await expect(secondSummary).toContainText("小計0");
  await expect(page.getByTestId("distance-top-scores-2")).toHaveText(
    "10: 0 / X: 0",
  );

  await expect(page.getByTestId("round-top-scores")).toHaveText("10: 1 / X: 1");
});

test("距離間で的のX有無・最高点数・次点数が異なると、ラウンド結果にX数/最高点数/次点数を表示しない", async ({
  page,
}) => {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "的構成不一致テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 18, totalEnds: 1, arrowsPerEnd: 1 },
      {
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: FIELD_TARGET_FACE_ID,
      },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await expect(page.getByTestId("round-top-scores")).toBeHidden();
  // 距離ごとの表示はそれぞれの的の構成にしたがって個別に出る。
  await expect(page.getByTestId("distance-top-scores-1")).toHaveText(
    "10: 0 / X: 0",
  );
  await expect(page.getByTestId("distance-top-scores-2")).toHaveText(
    "6: 0 / 5: 0",
  );
});

test("下にスクロールしても、ラウンド結果の合計が常に画面上部に見える", async ({
  page,
}) => {
  // 1画面に収まらないよう、エンド数を多めにしたラウンドを作成する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "ラウンド結果スクロール追従テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 90, totalEnds: 12, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  const scrollContainer = page.locator("main.overflow-y-auto");
  const roundSummary = page.getByTestId("round-summary");
  const backLink = page.getByRole("link", { name: "一覧へ戻る" });

  await scrollContainer.evaluate((el) => {
    el.scrollTop = 300;
  });

  // 一覧へ戻る・同期状態の行（h-14固定）も画面上部に張り付き、
  // 合計バーはその直下（top-14）に続けて張り付く。
  await expect(backLink).toBeVisible();
  const backLinkBox = await backLink.boundingBox();
  expect(backLinkBox?.y).toBeLessThan(20);

  await expect(roundSummary).toBeVisible();
  const summaryBox = await roundSummary.boundingBox();
  expect(summaryBox?.y).toBeLessThan(66);
  expect(summaryBox?.y).toBeGreaterThan(40);
});

test("下にスクロールして別の距離のエンドに移っても、現在の距離の距離結果が常に画面上部に見える", async ({
  page,
}) => {
  // 1画面に収まらないよう、距離ごとにエンド数を多めにしたラウンドを作成する。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "距離結果スクロール追従テスト",
    roundDate: "2026-08-24",
    distances: [
      { distance: 90, totalEnds: 12, arrowsPerEnd: 6 },
      { distance: 70, totalEnds: 12, arrowsPerEnd: 6 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  const scrollContainer = page.locator("main.overflow-y-auto");

  // 距離1の途中までスクロールすると、距離1の小計が画面上部に見える。
  await scrollContainer.evaluate((el) => {
    el.scrollTop = 300;
  });
  const distance1Subtotal = page
    .getByTestId("distance-summary-1")
    .locator(".sticky");
  await expect(distance1Subtotal).toBeVisible();
  await expect(distance1Subtotal).toContainText("小計0");
  const distance1Box = await distance1Subtotal.boundingBox();
  expect(distance1Box?.y).toBeLessThan(120);

  // 距離2の途中までスクロールすると、小計は距離2のものへ引き継がれる。
  const distance2Top = await page
    .getByTestId("distance-summary-2")
    .evaluate((el) => (el as HTMLElement).offsetTop);
  await scrollContainer.evaluate((el, top) => {
    el.scrollTop = top + 100;
  }, distance2Top);

  const distance2Subtotal = page
    .getByTestId("distance-summary-2")
    .locator(".sticky");
  await expect(distance2Subtotal).toBeVisible();
  await expect(distance2Subtotal).toContainText("小計0");
  const distance2Box = await distance2Subtotal.boundingBox();
  expect(distance2Box?.y).toBeLessThan(120);
});

test("点数ボタンをタップすると合計が更新される", async ({ page }) => {
  await expect(page.getByTestId("round-summary")).toContainText("合計0");

  await page.getByTestId("score-button-X").click();
  await expect(page.getByTestId("round-summary")).toContainText("合計10");

  await page.getByTestId("score-button-5").click();
  await expect(page.getByTestId("round-summary")).toContainText("合計15");
});

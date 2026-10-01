import { expect, test } from "@playwright/test";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
} from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test("history-01: 認証済みでラウンドが1件以上あるとき、/roundsを開くと、各ラウンドの名前・実施日・合計点が表示される", async ({
  page,
}) => {
  // Given
  const name = `一覧表示テスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
    shots: [
      {
        distanceIndex: 0,
        endNumber: 1,
        arrowNumber: 1,
        scoreStr: "7",
        scoreInt: 7,
      },
    ],
  });

  // When
  await page.goto("/rounds");

  // Then
  const roundLink = page.getByRole("link", { name: new RegExp(name) });
  await expect(roundLink).toBeVisible();
  await expect(roundLink).toContainText("2026-08-24");
  await expect(roundLink).toContainText("7点");
});

test("history-05: 認証済みで実施日の異なるラウンドが複数あるとき、/roundsを開くと、実施日の新しい順に表示される", async ({
  page,
}) => {
  // Given
  // 共有ユーザーには他のテストが作ったラウンドも並ぶため、2件の相対的な順序だけを確認する。
  // 挿入順と期待順を逆にして、並べ替えなしでは通らないようにする。
  const suffix = Date.now();
  const olderName = `並び順テスト-古い-${suffix}`;
  const newerName = `並び順テスト-新しい-${suffix}`;
  const distances = [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }];
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: olderName,
    roundDate: "2026-01-10",
    distances,
  });
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: newerName,
    roundDate: "2026-03-20",
    distances,
  });

  // When
  await page.goto("/rounds");

  // Then
  const cards = page.getByRole("main").getByRole("link", { name: /点$/ });
  await expect(cards.filter({ hasText: newerName })).toBeVisible();
  const texts = await cards.allTextContents();
  const newerIndex = texts.findIndex((text) => text.includes(newerName));
  const olderIndex = texts.findIndex((text) => text.includes(olderName));
  expect(olderIndex).toBeGreaterThanOrEqual(0);
  expect(newerIndex).toBeLessThan(olderIndex);
});

test("history-02: 新規作成ボタンをクリックすると、/rounds/newへ遷移する", async ({
  page,
}) => {
  // Given
  await page.goto("/rounds");

  // When
  await page.getByTestId("new-round-fab").click();

  // Then
  await expect(page).toHaveURL(/\/rounds\/new/);
});

test("history-03: ラウンドが1件以上あるとき、ラウンドカードをクリックすると、/rounds/[id]へ遷移する", async ({
  page,
}) => {
  // Given
  const name = `ラウンドカードテスト-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  // When
  await page.getByRole("link", { name: new RegExp(name) }).click();

  // Then
  await expect(page).toHaveURL(`/rounds/${roundId}`);
});

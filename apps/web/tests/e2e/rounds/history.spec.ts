import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH, waitForHydration } from "../helpers/auth";
import { getRoundRow, openOtherDevice } from "../helpers/other-device";
import { addRound, signInFreshUser } from "../helpers/round-fixtures";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

const navigationText = translatorFor("navigation");
const roundsText = translatorFor("rounds");

test.use({ storageState: SHARED_AUTH_STATE_PATH });

// 完了や入力中の有無で表示が変わるため、全てのテストは使い捨てのユーザーで前提を作る。
test.describe("履歴", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("履歴を開くと、完了したラウンドが名前・実施日・合計点で表示され、入力中のラウンドは表示されない", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    await addRound(credentials, "入力中の古い", "2026-01-10", {
      shots: [{ scoreStr: "7", scoreInt: 7 }],
    });
    await addRound(credentials, "完了の新しい", "2026-05-01", {
      completed: true,
    });
    await page.goto("/rounds");
    await waitForHydration(page);

    await page
      .getByRole("link", { name: navigationText("leftPanelHistory") })
      .click();

    await expect(page).toHaveURL(/\/rounds\/history$/);
    const card = page.getByRole("link", { name: /完了の新しい/ });
    await expect(card).toContainText("2026-05-01");
    await expect(card).toContainText(
      roundsText("roundTotalPoints", { total: "0" }),
    );
    await expect(page.getByText("入力中の古い")).toHaveCount(0);
    await expect(page.getByTestId("new-round-fab")).toHaveCount(0);

    // ホームの項目を押すと、ホームへ戻る。
    await page
      .getByRole("link", { name: navigationText("leftPanelHome") })
      .click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(page.getByText("入力中の古い")).toBeVisible();
  });

  test("履歴のURLを直接開いても、履歴が表示される", async ({ page }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    await addRound(credentials, "直接開く", "2026-05-01", { completed: true });

    await page.goto("/rounds/history");

    await expect(page).toHaveURL(/\/rounds\/history$/);
    await expect(page.getByRole("link", { name: /直接開く/ })).toBeVisible();
  });

  test("履歴のカードから開いた詳細の戻るで履歴へ、ホームのカードから開いた詳細の戻るでホームへ戻る", async ({
    page,
  }) => {
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page, "e2e-history");
    const completedName = `完了-${suffix}`;
    const inProgressName = `入力中-${suffix}`;
    const completedId = await addRound(
      credentials,
      completedName,
      "2026-05-01",
      {
        completed: true,
      },
    );
    const inProgressId = await addRound(
      credentials,
      inProgressName,
      "2026-04-01",
    );

    // 履歴のカードから詳細を開き、戻るで履歴へ戻る。
    await page.goto("/rounds/history");
    await page.getByRole("link", { name: new RegExp(completedName) }).click();
    await expect(page).toHaveURL(new RegExp(`/rounds/${completedId}`));
    await waitForHydration(page);
    await page.getByRole("link", { name: roundsText("back") }).click();
    await expect(page).toHaveURL(/\/rounds\/history$/);

    // ホームのカードから詳細を開き、戻るでホームへ戻る。
    await page.goto("/rounds");
    await page.getByRole("link", { name: new RegExp(inProgressName) }).click();
    await expect(page).toHaveURL(`/rounds/${inProgressId}`);
    await waitForHydration(page);
    await page.getByRole("link", { name: roundsText("back") }).click();
    await expect(page).toHaveURL(/\/rounds$/);
  });

  test("完了したラウンドを得点順に並べて種別で絞り込むと、再読み込みと詳細からの戻りで条件が保たれ、リセットで元の並びに戻る", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    await addRound(credentials, "屋外リカーブ", "2026-05-01", {
      completed: true,
      shots: [
        { scoreStr: "10", scoreInt: 10 },
        { scoreStr: "9", scoreInt: 9 },
      ],
    });
    const indoorCompoundId = await addRound(
      credentials,
      "屋内コンパウンド",
      "2026-05-02",
      {
        completed: true,
        format: "indoor",
        bowType: "compound",
        shots: [
          { scoreStr: "10", scoreInt: 10 },
          { scoreStr: "10", scoreInt: 10 },
          { scoreStr: "10", scoreInt: 10 },
        ],
      },
    );
    await addRound(credentials, "屋内リカーブ", "2026-05-03", {
      completed: true,
      format: "indoor",
      shots: [{ scoreStr: "8", scoreInt: 8 }],
    });
    const cards = page.getByRole("listitem");

    // 履歴を開き、既定の実施日の新しい順から、得点の高い順に並べ替える。
    await page.goto("/rounds/history");
    await expect(cards).toHaveText([
      /屋内リカーブ/,
      /屋内コンパウンド/,
      /屋外リカーブ/,
    ]);
    await page.getByTestId("history-sort-key-score").click();
    await expect(cards).toHaveText([
      /屋内コンパウンド/,
      /屋外リカーブ/,
      /屋内リカーブ/,
    ]);

    // 種別を屋内に絞り込み、一致する2件だけを得点の順に表示する。
    await page.getByTestId("history-filter-format-indoor").click();
    await expect(cards).toHaveText([/屋内コンパウンド/, /屋内リカーブ/]);

    // 再読み込みしても、並べ替えと絞り込みが保たれる。
    await page.reload();
    await expect(cards).toHaveText([/屋内コンパウンド/, /屋内リカーブ/]);
    await expect(page.getByTestId("history-sort-key-score")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // 1件の詳細を開き、戻って履歴へ移っても、条件が保たれる。
    await page.getByRole("link", { name: /屋内コンパウンド/ }).click();
    await expect(page).toHaveURL(new RegExp(`/rounds/${indoorCompoundId}`));
    await waitForHydration(page);
    await page.getByRole("link", { name: roundsText("back") }).click();
    await expect(page).toHaveURL(/\/rounds\/history$/);
    await expect(cards).toHaveText([/屋内コンパウンド/, /屋内リカーブ/]);

    // 欄を閉じて再読み込みすると、閉じたまま絞り込みが適用されている。
    await page.getByTestId("history-controls-toggle").click();
    await expect(page.getByTestId("history-controls")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("history-controls")).toHaveCount(0);
    await expect(cards).toHaveText([/屋内コンパウンド/, /屋内リカーブ/]);

    // 欄を開いてリセットすると、3件が実施日の新しい順に戻る。
    await page.getByTestId("history-controls-toggle").click();
    await page.getByTestId("history-controls-reset").click();
    await expect(cards).toHaveText([
      /屋内リカーブ/,
      /屋内コンパウンド/,
      /屋外リカーブ/,
    ]);
  });

  test("オフラインで入力を完了するとホームから消えて履歴にも出ず、オンラインに戻って同期された後に履歴を開くと1件だけ表示される", async ({
    page,
    context,
  }) => {
    // 入力中のラウンドが2件あるホームを開く。
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page, "e2e-history");
    const completingName = `完了にする-${suffix}`;
    const remainingName = `残る-${suffix}`;
    const completingId = await addRound(
      credentials,
      completingName,
      "2026-03-01",
    );
    await addRound(credentials, remainingName, "2026-02-01");
    await page.goto("/rounds");
    await expect(page.getByText(remainingName)).toBeVisible();

    // 1件をラウンド詳細で開き、オフラインで入力を完了してホームへ移る。
    await page.getByText(completingName).click();
    await waitForHydration(page);
    await waitForServiceWorkerControl(page);
    await goOffline(context);
    await page.getByTestId("complete-round-button").click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(page.getByText(remainingName)).toBeVisible();
    await expect(page.getByText(completingName)).toHaveCount(0);

    // オンラインに戻り、完了がサーバーへ届くのを待ってから、履歴に1件だけ出るのを確かめる。
    await comeBackOnline(context, page);
    const { supabase } = await openOtherDevice(
      credentials.email,
      credentials.password,
    );
    await expect
      .poll(async () => (await getRoundRow(supabase, completingId)).status, {
        timeout: 15_000,
      })
      .toBe("completed");
    await page
      .getByRole("link", { name: navigationText("leftPanelHistory") })
      .click();
    await expect(page).toHaveURL(/\/rounds\/history$/);
    await expect(page.getByText(completingName)).toHaveCount(1);
    await expect(page.getByText(remainingName)).toHaveCount(0);
  });
});

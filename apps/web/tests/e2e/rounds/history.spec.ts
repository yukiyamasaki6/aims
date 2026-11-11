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

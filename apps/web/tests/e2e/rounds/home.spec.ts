import type { Locator } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signOutFromSettings,
} from "../helpers/auth";
import {
  disableRound,
  openOtherDevice,
  updateRound,
} from "../helpers/other-device";
import { addRound, signInFreshUser } from "../helpers/round-fixtures";
import { createRound } from "../helpers/rounds";
import {
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

const roundsText = translatorFor("rounds");

// 要素の中心の最前面が、その要素自身か子孫であることを、スクロールが止まるまで待って確かめる。
async function expectFrontmostAtCenter(target: Locator) {
  await expect
    .poll(() =>
      target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return hit !== null && el.contains(hit);
      }),
    )
    .toBe(true);
}

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test("ホームの右下のラウンドの開始ボタンを押すと、ラウンドの開始画面へ移動する", async ({
  page,
}) => {
  await page.goto("/rounds");

  await page.getByTestId("new-round-fab").click();

  await expect(page).toHaveURL(/\/rounds\/new/);
  await expect(
    page.getByRole("heading", { level: 1, name: roundsText("newRoundTitle") }),
  ).toBeVisible();
  await expect(page.getByTestId("round-start-button")).toBeVisible();
});

test("入力中のラウンドのカードを押すと、そのラウンドの詳細画面へ移動する", async ({
  page,
}) => {
  const name = `ラウンドカードテスト-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await page.goto("/rounds");

  await page.getByRole("link", { name: new RegExp(name) }).click();

  await expect(page).toHaveURL(`/rounds/${roundId}`);
  await expect(page.getByTestId("round-summary")).toContainText(
    roundsText("roundTotal", { total: "0" }),
  );
});

// 入力中のラウンドの有無で表示が変わるため、以降のテストは使い捨てのユーザーで前提を作る。
test.describe("使い捨てのユーザー", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("ホームの右下のラウンドの開始ボタンへTabで届き、Enterでラウンドの開始画面へ移動する", async ({
    page,
  }) => {
    // ホームを開き、右下のボタンへTabで進む。
    await signInFreshUser(page, "e2e-home-tab");
    await page.goto("/rounds");
    const button = page.getByTestId("new-round-fab");
    await expect(button).toHaveAttribute("data-hydrated", "true");
    for (let i = 0; i < 30; i++) {
      if (await button.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(button).toBeFocused();

    // Enterで開始画面へ移る。
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/rounds\/new/);
    await expect(page.getByTestId("round-start-button")).toBeVisible();
  });

  test("幅390pxで入力中のラウンドが画面に収まらないほどあっても、本文を末尾までスクロールすると、最後のカードとそのメニューが右下のラウンドの開始ボタンに隠れない", async ({
    page,
  }) => {
    // 画面に収まらない数の入力中のラウンドを用意して、幅390pxのホームを開く。
    const credentials = await signInFreshUser(page, "e2e-home-cover");
    for (let i = 0; i < 10; i++) {
      await addRound(
        credentials,
        `被り確認-${i}`,
        `2026-03-${String(i + 1).padStart(2, "0")}`,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rounds");
    await expect(page.getByRole("listitem")).toHaveCount(10);

    // 本文を末尾までスクロールして、最後のカードとメニューの中心の最前面が、それら自身である。
    await page
      .getByRole("main")
      .evaluate((main) => main.parentElement?.scrollTo(0, main.scrollHeight));
    const lastItem = page.getByRole("listitem").last();
    await expectFrontmostAtCenter(lastItem.getByRole("link"));
    await expectFrontmostAtCenter(lastItem.getByTestId("round-menu-trigger"));
  });

  test("オンラインでホームを表示した後にオフラインで開き直しても、入力中のラウンドが合計点つきで表示され、そのカードからラウンド詳細を開ける", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-home");
    const name = `入力中-${Date.now()}`;
    const roundId = await addRound(credentials, name, "2026-03-01", {
      shots: [{ scoreStr: "9", scoreInt: 9 }],
    });
    await page.goto("/rounds");
    const card = page.getByRole("link", { name: new RegExp(name) });
    await expect(card).toBeVisible();
    await waitForServiceWorkerControl(page);
    await goOffline(page.context());
    await page.goto("/rounds");

    await expect(card).toContainText("2026-03-01");
    await expect(card).toContainText(
      roundsText("roundTotalPoints", { total: "9" }),
    );
    await expect(page.getByText(roundsText("fetchOffline"))).toHaveCount(0);

    // 入力中のラウンドのカードを押し、オフラインのままラウンド詳細を開く。
    await card.click();
    await expect(page).toHaveURL(`/rounds/${roundId}`);
    await expect(page.getByTestId("round-summary")).toContainText(
      roundsText("roundTotal", { total: "9" }),
    );
  });

  test("他の端末で完了にしたラウンドと削除したラウンドは、同期の後にホームから消え、入力中のままのラウンドは残る", async ({
    page,
  }) => {
    // ホームを開き、入力中の3件を端末に保持させる。
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page, "e2e-home");
    const completingName = `完了にする-${suffix}`;
    const deletingName = `削除する-${suffix}`;
    const remainingName = `残る-${suffix}`;
    const completingId = await addRound(
      credentials,
      completingName,
      "2026-03-03",
    );
    const deletingId = await addRound(credentials, deletingName, "2026-03-02");
    await addRound(credentials, remainingName, "2026-03-01");
    await page.goto("/rounds");
    await expect(page.getByText(completingName)).toBeVisible();
    await expect(page.getByText(deletingName)).toBeVisible();
    await expect(page.getByText(remainingName)).toBeVisible();

    // 他の端末で1件を完了にし、1件を削除してから、ホームを開き直す。
    const { supabase } = await openOtherDevice(
      credentials.email,
      credentials.password,
    );
    await updateRound(supabase, completingId, { status: "completed" });
    await disableRound(supabase, deletingId);
    await page.goto("/rounds");

    // 同期の反映は、入力中のままのラウンドが残ったまま、2件が消えることで確かめる。
    await expect(page.getByText(completingName)).toHaveCount(0);
    await expect(page.getByText(deletingName)).toHaveCount(0);
    await expect(page.getByText(remainingName)).toBeVisible();
  });

  test("端末に別のユーザーの入力中のラウンドがあるとき、別のユーザーでサインインしてオフラインでホームを開くと、そのラウンドは表示されない", async ({
    page,
  }) => {
    // ユーザーAでホームを開き、入力中のラウンドを端末に保持させる。
    const credentials = await signInFreshUser(page, "e2e-home");
    const name = `別ユーザー-${Date.now()}`;
    await addRound(credentials, name, "2026-03-01");
    await page.goto("/rounds");
    await expect(page.getByText(name)).toBeVisible();

    // サインアウトして、サインイン画面へ移る。
    await signOutFromSettings(page);

    // ユーザーBでサインインし、オフラインでホームを開く。
    await signInFreshUser(page, "e2e-home");
    await waitForServiceWorkerControl(page);
    await goOffline(page.context());
    await page.goto("/rounds");
    await expect(page.getByText(roundsText("homeEmpty"))).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
  });
});

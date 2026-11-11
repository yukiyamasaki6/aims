import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
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

const authText = translatorFor("auth");
const roundsText = translatorFor("rounds");

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test("新規作成ボタンを押すと、ラウンド作成画面へ移動する", async ({ page }) => {
  await page.goto("/rounds");

  await page.getByTestId("new-round-fab").click();

  await expect(page).toHaveURL(/\/rounds\/new/);
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
    await page.getByRole("button", { name: authText("signOut") }).click();
    await page
      .getByRole("button", { name: authText("signOutConfirmLabel") })
      .click();
    await expect(page).toHaveURL(/\/signin/);

    // ユーザーBでサインインし、オフラインでホームを開く。
    await signInFreshUser(page, "e2e-home");
    await waitForServiceWorkerControl(page);
    await goOffline(page.context());
    await page.goto("/rounds");
    await expect(page.getByText(roundsText("homeEmpty"))).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
  });
});

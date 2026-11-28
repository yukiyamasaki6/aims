import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  clickSignInAndAwaitRounds,
  createConfirmedUser,
  getSharedEmail,
  injectStoredSession,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signOutFromSettings,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { resetOtpSendInterval } from "../helpers/auth-db";
import { expectKeypadSettled } from "../helpers/keypad";
import {
  beginAs,
  type DbSession,
  expectWaitingForLock,
  withDbSessions,
  withLocalDb,
} from "../helpers/local-db";
import { getOtpCodeFromMailpit, mailIds } from "../helpers/mailpit";
import {
  addShooterAs,
  clearShotAs,
  getDistanceIds,
  getRoundRow,
  goOnline,
  openOtherDevice,
  recordShotAs,
  savedRoundCount,
  updateRound,
} from "../helpers/other-device";
import { expectRoundBasesFetched } from "../helpers/reference-data";
import { editRoundName, roundName } from "../helpers/round-name";
import {
  createRound,
  expectNoSyncStatus,
  signInAsTestUser,
} from "../helpers/rounds";
import { cell, expectCells } from "../helpers/score-cells";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { revokeAllSessions } from "../helpers/session-revoke";
import { mockTurnstile, waitForTurnstileToken } from "../helpers/turnstile";

const authText = translatorFor("auth");
const roundsText = translatorFor("rounds");

test.use({ storageState: SHARED_AUTH_STATE_PATH });

// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;
const RECORD_SHOTS_RPC = "**/rest/v1/rpc/record_shots";

let roundId: string;

test.beforeEach(async () => {
  roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "同期テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
});

async function openRound(page: Page) {
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
}

// ラウンド名を変更して保存する。保存は操作の列に積まれ、update_round RPCで送信される。
async function saveRoundName(page: Page, name: string) {
  await editRoundName(page, name);
}

async function reloadRound(page: Page) {
  await page.reload();
  await waitForHydration(page);
}

// 保存された生きている矢を「エンド-マスの番号:点数」の配列で、文字列の順に返す。
async function savedShots(supabase: SupabaseClient, distanceId: string) {
  const { data, error } = await supabase
    .from("shots")
    .select("end_number, shot_number, score_str")
    .eq("distance_id", distanceId)
    .is("disabled_at", null);
  if (error) throw error;
  return data
    .map((shot) => `${shot.end_number}-${shot.shot_number}:${shot.score_str}`)
    .sort();
}

async function expectSavedShots(
  supabase: SupabaseClient,
  distanceId: string,
  expected: string[],
) {
  await expect
    .poll(() => savedShots(supabase, distanceId), { timeout: 30_000 })
    .toEqual(expected);
}

// 一覧と詳細の行き来は、ハブの常駐を確かめるため、画面を読み込み直さないリンクの遷移で行う。
async function backToList(page: Page) {
  await page.getByRole("link", { name: roundsText("back") }).click();
  await expect(page).toHaveURL(/\/rounds$/);
}

async function openFromList(page: Page, name: string) {
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("round-summary")).toBeVisible();
}

async function createNamedRound(email: string, password: string, name: string) {
  const id = await createRound({
    email,
    password,
    name,
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  const { supabase } = await signInAsTestUser(email, password);
  const [distanceId] = await getDistanceIds(supabase, id);
  return { id, name, distanceId, supabase };
}

function uniqueName(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

async function signInOnPage(
  page: Page,
  user: { email: string; password: string },
) {
  await page.getByPlaceholder("you@example.com").fill(user.email);
  await resetOtpSendInterval(user.email);
  const previous = await mailIds(user.email);
  await waitForTurnstileToken(page, 1);
  await page.getByRole("button", { name: authText("emailContinue") }).click();
  await expect(
    page.getByPlaceholder(authText("otpCodePlaceholder")),
  ).toBeVisible();
  await page
    .getByPlaceholder(authText("otpCodePlaceholder"))
    .fill(await getOtpCodeFromMailpit(user.email, previous));
  await clickSignInAndAwaitRounds(
    page,
    page.getByRole("button", { name: authText("otpVerify"), exact: true }),
  );
}

async function signOutOnPage(page: Page) {
  await signOutFromSettings(page);
  // 水和の前に入力すると、メールアドレス欄が水和で空に戻るため、水和を待つ。
  await waitForHydration(page);
}

// ラウンド一覧にそのラウンドへのリンクが何件あるか。
function roundLinks(page: Page, id: string) {
  return page.locator(`a[href="/rounds/${id}"]`);
}

// 他の端末のクライアントと距離のIDが要るテスト用に、指定した構成のラウンドを作り直す。
async function createSyncRound(input: {
  distances: { distance: number; totalEnds: number; arrowsPerEnd: number }[];
}) {
  roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "自動解決テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: input.distances,
  });
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const distanceIds = await getDistanceIds(device.supabase, roundId);
  return { ...device, distanceIds };
}

test("ラウンドの詳細で点数を記録すると、送信中も保存の後も同期の状態が表示されず、点数が保存される", async ({
  page,
}) => {
  // 点数の送信を止めて点数を記録し、送信中に同期の状態が表示されないことを確かめる。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  let requested = false;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    requested = true;
    await requestGate;
    await route.continue();
  });
  await openRound(page);
  await expect(page.getByTestId("round-summary")).toBeVisible();
  await expectNoSyncStatus(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => requested).toBe(true);
  await expectCells(page, 1, 1, ["10", null, null]);
  await expectNoSyncStatus(page);

  // 送信を通し、点数が保存された後も同期の状態が表示されないことを確かめる。
  releaseRequest();
  await expectSavedShots(device.supabase, distanceId, ["1-1:10"]);
  await expectNoSyncStatus(page);
});

test("オフラインで点数を記録してその矢を消し、別の点数を記録してラウンドの名前を保存すると、オンラインに戻った後、操作なしで名前と最後の点数だけが保存され、再読み込みしても最後の点数が表示される", async ({
  page,
}) => {
  // オフラインで10を記録してその矢を消し、9を記録してから、ラウンドの名前を保存する。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-10").click();
  await cell(page, 1, 1, 1).click();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);
  await page.getByTestId("score-button-clear").click();
  await page.getByTestId("score-button-9").click();
  await expectCells(page, 1, 1, ["9", null, null]);
  await saveRoundName(page, "オンライン復帰テスト");
  await expect(roundName(page)).toContainText("オンライン復帰テスト");

  // オンラインに戻り、操作なしで名前と最後の点数だけが保存されることを確かめる。
  // ページの再読み込みや再訪問をせず、オンライン復帰のイベントだけで送らせる。
  await goOnline(page);
  await expect
    .poll(async () => (await getRoundRow(device.supabase, roundId)).name, {
      timeout: 15_000,
    })
    .toBe("オンライン復帰テスト");
  await expectSavedShots(device.supabase, distanceId, ["1-1:9"]);

  // 再読み込みし、最後の点数だけが表示されることを確かめる。
  await reloadRound(page);
  await expectCells(page, 1, 1, ["9", null, null]);
});

test("他の端末が同じマスへ先に記録した後でオンラインに戻ると、この端末の点数だけがそのマスに残り、再読み込みしても2本の矢にならない", async ({
  page,
}) => {
  // オフラインで先頭のマスに10を記録し、他の端末が同じマスへ先に9を記録する。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-10").click();
  await expectCells(page, 1, 1, ["10", null, null]);
  await recordShotAs(
    device.supabase,
    { distanceId, endNumber: 1, shotNumber: 1 },
    { scoreStr: "9", scoreInt: 9 },
  );

  // オンラインに戻り、後から保存されたこの端末の点数だけがそのマスに残ることを確かめる。
  await goOnline(page);
  await expectSavedShots(device.supabase, distanceId, ["1-1:10"]);

  // 再読み込みして、そのマスに1つだけ表示されることを確かめる。
  await reloadRound(page);
  await expectCells(page, 1, 1, ["10", null, null]);
});

test("他の端末が同じエンドの別のマスへ記録した後でオンラインに戻ると、両方の矢が保存され、再読み込みしてどちらも表示される", async ({
  page,
}) => {
  // オフラインで先頭のマスに10を記録し、他の端末が2番目のマスへ8を記録する。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-10").click();
  await expectCells(page, 1, 1, ["10", null, null]);
  await recordShotAs(
    device.supabase,
    { distanceId, endNumber: 1, shotNumber: 2 },
    { scoreStr: "8", scoreInt: 8 },
  );

  // オンラインに戻り、両方の矢が保存されることを確かめる。
  await goOnline(page);
  await expectSavedShots(device.supabase, distanceId, ["1-1:10", "1-2:8"]);

  // 再読み込みして、どちらも表示されることを確かめる。
  await reloadRound(page);
  await expectCells(page, 1, 1, ["10", "8", null]);
});

test("一つ戻るは、他の端末が同じエンドの別のマスへ記録した矢を消さない", async ({
  page,
}) => {
  // オフラインで先頭のマスに10を記録し、他の端末が2番目のマスへ8を記録した後、オンラインに戻る。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-10").click();
  await expectCells(page, 1, 1, ["10", null, null]);
  await recordShotAs(
    device.supabase,
    { distanceId, endNumber: 1, shotNumber: 2 },
    { scoreStr: "8", scoreInt: 8 },
  );
  await goOnline(page);
  await expectSavedShots(device.supabase, distanceId, ["1-1:10", "1-2:8"]);

  // 一つ戻り、この端末の矢だけが消えることを確かめる。
  await page.getByTestId("score-button-undo").click();
  await expectSavedShots(device.supabase, distanceId, ["1-2:8"]);
  await reloadRound(page);
  await expectCells(page, 1, 1, [null, "8", null]);
});

test("他の端末が消したマスを知らずに直すと、直した点数で再び表示され、直したマスを他の端末が後で消すと空になる", async ({
  page,
}) => {
  // 先頭のマスに10を記録済みのラウンドを開き、オフラインにして、他の端末にそのマスを消させる。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "他端末の消去テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    shots: [
      {
        distanceIndex: 0,
        endNumber: 1,
        shotNumber: 1,
        scoreStr: "10",
        scoreInt: 10,
      },
    ],
  });
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  const cellOnServer = { distanceId, endNumber: 1, shotNumber: 1 };
  await openRound(page);
  await expectCells(page, 1, 1, ["10", null, null]);
  await page.context().setOffline(true);
  await clearShotAs(device.supabase, cellOnServer);

  // 消されたと知らずにそのマスを7に直し、オンラインに戻ると、7で保存される。
  await cell(page, 1, 1, 1).click();
  await page.getByTestId("score-button-7").click();
  await goOnline(page);
  await expectSavedShots(device.supabase, distanceId, ["1-1:7"]);
  await reloadRound(page);
  await expectCells(page, 1, 1, ["7", null, null]);

  // 他の端末が直したマスを後で消すと、再読み込みで空になる。
  await clearShotAs(device.supabase, cellOnServer);
  await expectSavedShots(device.supabase, distanceId, []);
  await reloadRound(page);
  await expectCells(page, 1, 1, [null, null, null]);
});

test("オフラインで入力を完了にした後に、他の端末がラウンドの名前を変えると、オンラインに戻った後、他の端末でも完了と他の端末の名前の両方が保存され、開き直しても完了のままである", async ({
  page,
}) => {
  // オフラインで入力を完了にし、ラウンド一覧へ移る。
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  await openRound(page);
  await waitForServiceWorkerControl(page);
  await page.context().setOffline(true);
  await page.getByTestId("complete-round-button").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page).toHaveURL(/\/rounds$/);

  // 他の端末が名前を変えた後でオンラインに戻り、完了と他の端末の名前の両方が保存されることを確かめる。
  await updateRound(supabase, roundId, { name: "他端末の名前" });
  await goOnline(page);
  await expect
    .poll(
      async () => {
        const row = await getRoundRow(supabase, roundId);
        return { status: row.status, name: row.name };
      },
      { timeout: 15_000 },
    )
    .toEqual({ status: "completed", name: "他端末の名前" });

  // ラウンドを開き直し、入力を完了するボタンが表示されないことを確かめる。
  await openRound(page);
  await expect(page.getByTestId("round-summary")).toBeVisible();
  await expect(page.getByTestId("complete-round-button")).toBeHidden();
});

test("オフラインで点数を記録してラウンド一覧へ移り、オンラインに戻ると、そのラウンドを開き直さずに点数が保存される", async ({
  page,
}) => {
  // オフラインで点数を記録する。
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await openRound(page);
  await waitForServiceWorkerControl(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-10").click();
  // 点数は保存の完了後に表示されるため、一覧へ移る前に端末へ保存済みである。
  await expectCells(page, 1, 1, ["10", null, null]);

  await backToList(page);

  // オンラインに戻り、そのラウンドを開き直さずに点数が保存されることを確かめる。
  await goOnline(page);
  await expectSavedShots(supabase, distanceIds[0], ["1-1:10"]);
});

test("送信に失敗した点数を残してアプリを閉じ、通信のある状態でラウンド一覧を開くと、そのラウンドを開かずに点数が保存される", async ({
  page,
}) => {
  // 送信が失敗する状態で点数を記録し、送信の失敗を待つ。
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  let attempts = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    attempts++;
    await route.abort("failed");
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attempts).toBeGreaterThan(0);

  // アプリを閉じ、通信のある状態でラウンド一覧を開いて、そのラウンドを開かずに点数が保存されることを確かめる。
  const context = page.context();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/rounds");
  await waitForHydration(reopened);
  await expectSavedShots(supabase, distanceIds[0], ["1-1:10"]);
});

test("オフラインで開始したラウンドに点数を記録してラウンド一覧へ移り、オンラインに戻ると、そのラウンドを開き直さずに保存されて矢は射手1になり、一覧に1件だけ表示され、開くと点数が表示される", async ({
  page,
}) => {
  // オフラインで、距離を持つプリセットを選んでラウンドを開始する。
  await page.goto("/rounds/new");
  await waitForHydration(page);
  await waitForServiceWorkerControl(page);
  await expectRoundBasesFetched(page);
  const preset = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "WA 1440" });
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await goOffline(page.context());
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await waitForHydration(page);
  const id = page.url().split("/").pop() as string;

  // 先頭のマスに点数を記録して、ラウンド一覧へ移る。
  await page.getByTestId("score-button-10").click();
  await expect(cell(page, 1, 1, 1)).toHaveText("10");

  await backToList(page);

  // オンラインに戻り、そのラウンドが保存されたことを確かめる。
  await comeBackOnline(page.context(), page);
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  await expect
    .poll(() => savedRoundCount(supabase, id), { timeout: 30_000 })
    .toBe(1);

  const [distanceId] = await getDistanceIds(supabase, id);
  await expect
    .poll(
      async () => {
        const { data, error } = await supabase
          .from("shots")
          .select("end_number, shot_number, score_str, shooter_number")
          .eq("distance_id", distanceId);
        if (error) throw error;
        return data;
      },
      { timeout: 30_000 },
    )
    .toEqual([
      { end_number: 1, shot_number: 1, score_str: "10", shooter_number: 1 },
    ]);

  // ラウンド一覧を読み込み直し、そのラウンドが1件だけ表示されることを確かめる。
  await page.reload();
  await waitForHydration(page);
  await expect(roundLinks(page, id)).toHaveCount(1);

  // ラウンドを開いて読み込み直し、点数が表示されることを確かめる。
  await roundLinks(page, id).click();
  await expect(page).toHaveURL(new RegExp(`/rounds/${id}$`));
  await reloadRound(page);
  await expect(cell(page, 1, 1, 1)).toHaveText("10");
});

// サーバー側でセッションを失効させるため、共有のユーザーではなく使い捨てのユーザーで行う。
test.describe("サインインが切れた後の再送", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("サインインが切れて送れなかった点数は、ラウンド一覧にいるままサインインし直すと、そのラウンドを開き直さずに保存される", async ({
    page,
  }) => {
    // 使い捨てのユーザーでサインインし、送信が失敗する状態で点数を記録する。
    // 時計は画面遷移より前に差し替える必要があるため、サインインの前に呼ぶ。
    const credentials = {
      email: `e2e-sync-expired-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`,
      password: "password-e2e-sync",
    };
    await page.clock.install();
    await signUpAndSignIn(page, credentials);
    roundId = await createRound({
      ...credentials,
      name: "失効テスト",
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    });
    const device = await openOtherDevice(
      credentials.email,
      credentials.password,
    );
    const [distanceId] = await getDistanceIds(device.supabase, roundId);
    await mockTurnstile(page);
    let attempts = 0;
    await page.route(RECORD_SHOTS_RPC, async (route) => {
      attempts++;
      await route.abort("failed");
    });
    await openRound(page);
    await page.getByTestId("score-button-10").click();
    await expect.poll(() => attempts).toBeGreaterThan(0);

    await backToList(page);

    // サーバー側でセッションを失効させ、通信を戻し、アクセストークンの期限を過ぎさせる。
    // 更新の拒否を検知した共通のガードがサインイン画面へ移す。
    // テストからサインイン画面を開くと、ガードの遷移と競合して中断されるため、ガードの遷移を待つ。
    await revokeAllSessions(credentials);
    await page.unroute(RECORD_SHOTS_RPC);
    await page.clock.fastForward(PAST_JWT_EXPIRY_MS);
    await expect(page).toHaveURL(/\/signin(\?|$)/);
    await waitForHydration(page);

    // サインインし直してラウンド一覧へ戻り、そのラウンドを開き直さずに点数が保存されることを確かめる。
    await signInOnPage(page, credentials);
    await expect(page).toHaveURL(/\/rounds$/);
    await expectSavedShots(device.supabase, distanceId, ["1-1:10"]);
  });
});

test("別の利用者の未送信の点数が残る端末でサインインして点数を記録しても、別の利用者の点数は送られず、表示されない", async ({
  page,
  context,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing application URL in e2e test.");
  // 利用者Aでサインインする。
  const userA = {
    email: `user-a-${randomUUID()}@example.com`,
    password: "password-e2e-a",
  };
  const userB = {
    email: `user-b-${randomUUID()}@example.com`,
    password: "password-e2e-b",
  };
  await createConfirmedUser(userA);
  await createConfirmedUser(userB);
  const roundA = await createNamedRound(
    userA.email,
    userA.password,
    uniqueName("利用者A"),
  );
  const roundB = await createNamedRound(
    userB.email,
    userB.password,
    uniqueName("利用者B"),
  );
  await context.clearCookies();
  await mockTurnstile(page);
  // 利用者Aの点数の送信は、利用者Bの間も失敗させ続け、試行の回数を数える。
  let attemptsOfA = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    const isA = (route.request().postData() ?? "").includes(roundA.distanceId);
    if (!isA) {
      await route.continue();
      return;
    }
    attemptsOfA++;
    await route.abort("failed");
  });
  // 利用者Aは、ラウンドの準備で確認済みのセッションを渡す(画面のサインインは同じ宛先の送信間隔を待つため)。
  await injectStoredSession(context, baseURL, userA.email);
  await page.goto("/rounds");
  await waitForHydration(page);

  await openFromList(page, roundA.name);

  // 利用者Aのラウンドで、送信が失敗する状態で点数を記録する。
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attemptsOfA).toBeGreaterThan(0);

  await signOutOnPage(page);

  // 利用者Bでサインインする。
  const attemptsBeforeB = attemptsOfA;
  await injectStoredSession(context, baseURL, userB.email);
  await page.goto("/rounds");
  await waitForHydration(page);

  await openFromList(page, roundB.name);

  // 利用者Bのラウンドで点数を記録して保存されるのを確かめ、利用者Aの点数が送られず、保存されていないことを確かめる。
  await page.getByTestId("score-button-9").click();
  await expectSavedShots(roundB.supabase, roundB.distanceId, ["1-1:9"]);
  expect(attemptsOfA).toBe(attemptsBeforeB);
  expect(await savedShots(roundA.supabase, roundA.distanceId)).toEqual([]);

  await backToList(page);
  await expect(page.getByText(roundA.name)).toHaveCount(0);
});

// 公開APIを、利用者のアクセストークンで呼ぶ。数値の書き方をそのまま届けるため、本文は文字列で渡す。
async function postRpc(supabase: SupabaseClient, fn: string, body: string) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`,
    {
      method: "POST",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        authorization: `Bearer ${data.session?.access_token}`,
        "content-type": "application/json",
      },
      body,
    },
  );
  if (response.ok) return { status: response.status, code: null };
  const { code } = (await response.json()) as { code: string };
  return { status: response.status, code };
}

// 射手番号のJSONの書き方。`2.0`と`2e0`は整数の2である。
const ACCEPTED_NUMBERS = ["2.0", "2e0", "1", "2", "2147483647"];
// nullは、番号のキーの省略を表す。
const REJECTED_NUMBERS = [
  null,
  "null",
  '"2"',
  '"abc"',
  "true",
  "[2]",
  '{"n":2}',
  "0",
  "-1",
  "1.5",
  "2147483648",
  "99999999999999999999",
];
const accepted = { status: 200, code: null };
const rejected = { status: 422, code: "PT422" };

test("射手の追加の公開APIは、有効な射手番号を受理し、省略と不正な番号をHTTP 422のPT422で拒否する", async () => {
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const add = (number: string | null) => {
    const argument = number === null ? "" : `,"p_shooter_number":${number}`;
    return postRpc(
      supabase,
      "add_round_shooter",
      `{"p_round_id":"${roundId}"${argument}}`,
    );
  };

  for (const number of ACCEPTED_NUMBERS) {
    expect(await add(number), `番号 ${number}`).toEqual(accepted);
  }
  for (const number of REJECTED_NUMBERS) {
    expect(await add(number), `番号 ${number}`).toEqual(rejected);
  }

  const { data, error } = await supabase
    .from("round_users")
    .select("shooter_number")
    .eq("round_id", roundId)
    .order("shooter_number");
  expect(error).toBeNull();
  expect(data?.map((row) => row.shooter_number)).toEqual([1, 2, 2147483647]);
});

test("矢の記録の公開APIは、有効な射手番号を受理して保存し、省略と不正な番号をHTTP 422のPT422で拒否する", async () => {
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(supabase, roundId);
  await addShooterAs(supabase, roundId, 2);
  await addShooterAs(supabase, roundId, 2147483647);
  // 値ごとに別のマスへ記録する。
  const record = (number: string | null, index: number) => {
    const shooter = number === null ? "" : `,"shooter_number":${number}`;
    const cellJson = `"end_number":${Math.floor(index / 3) + 1},"shot_number":${(index % 3) + 1}`;
    return postRpc(
      supabase,
      "record_shots",
      `{"p_shots":[{"shot_event_id":"${randomUUID()}","distance_id":"${distanceId}",${cellJson},"score_str":"10","score_int":10${shooter}}]}`,
    );
  };

  for (const [index, number] of ACCEPTED_NUMBERS.entries()) {
    expect(await record(number, index), `番号 ${number}`).toEqual(accepted);
  }
  for (const [index, number] of REJECTED_NUMBERS.entries()) {
    const cellIndex = ACCEPTED_NUMBERS.length + index;
    expect(await record(number, cellIndex), `番号 ${number}`).toEqual(rejected);
  }

  const { data, error } = await supabase
    .from("shots")
    .select("end_number, shot_number, shooter_number")
    .eq("distance_id", distanceId)
    .order("end_number")
    .order("shot_number");
  expect(error).toBeNull();
  expect(data?.map((shot) => shot.shooter_number)).toEqual([
    2, 2, 1, 2, 2147483647,
  ]);
});

// 同じ距離の作成を、指定した接続から呼ぶ。
function createDistanceOn(
  session: DbSession,
  ids: { eventId: string; distanceId: string },
) {
  const result = session.client.query<{ result: Record<string, unknown> }>(
    `select public.create_distance($1, $2, $3, 'b', 30, 12, 3,
       'a1000000-0000-0000-0000-000000000001', true) as result`,
    [ids.eventId, ids.distanceId, roundId],
  );
  // 待ちの確認が先に失敗しても、接続を閉じるときの失敗を未処理にしない。
  result.catch(() => undefined);
  return result;
}

// 保存された距離と、その作成の履歴の件数。
function distanceCounts(distanceId: string) {
  return withLocalDb(async (client) => {
    const { rows } = await client.query(
      `select (select count(*)::int from public.distances where id = $1) as distances,
              (select count(*)::int from public.distance_events where distance_id = $1) as events`,
      [distanceId],
    );
    return rows[0];
  });
}

const createdDistance = { revision: 1, applied: true, reason: null };

test("2接続から同じ番号の射手を同時に追加すると、後の追加は先の確定を待ち、両方適用されて射手は1行になる", async () => {
  const { userId } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const results = await withDbSessions(2, async ([first, second]) => {
    const add = (session: DbSession) =>
      session.client.query<{ result: { applied: boolean } }>(
        "select public.add_round_shooter($1, '2'::jsonb) as result",
        [roundId],
      );
    await beginAs(first, userId);
    await beginAs(second, userId);
    const firstResult = await add(first);
    const waiting = add(second);
    waiting.catch(() => undefined);
    await expectWaitingForLock(second);
    await first.client.query("commit");
    const secondResult = await waiting;
    await second.client.query("commit");
    return [firstResult, secondResult].map((r) => r.rows[0].result.applied);
  });

  expect(results).toEqual([true, true]);
  const { rows } = await withLocalDb((client) =>
    client.query(
      "select count(*)::int as count from public.round_users where round_id = $1 and shooter_number = 2",
      [roundId],
    ),
  );
  expect(rows).toEqual([{ count: 1 }]);
});

test("未確定の同じ作成と並行する距離の作成は、先の確定を待って記録した結果を返し、距離は1つになる", async () => {
  const { userId } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const ids = { eventId: randomUUID(), distanceId: randomUUID() };
  const results = await withDbSessions(2, async ([first, second]) => {
    await beginAs(first, userId);
    await beginAs(second, userId);
    const firstResult = await createDistanceOn(first, ids);
    const waiting = createDistanceOn(second, ids);
    await expectWaitingForLock(second);
    await first.client.query("commit");
    const secondResult = await waiting;
    await second.client.query("commit");
    return [firstResult, secondResult].map((r) => r.rows[0].result);
  });

  expect(results).toEqual([createdDistance, createdDistance]);
  expect(await distanceCounts(ids.distanceId)).toEqual({
    distances: 1,
    events: 1,
  });
});

test("操作の照合の後に同じ作成が確定しても、距離の作成は拒否せず記録した結果を返し、距離は1つになる", async () => {
  const { userId } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const ids = { eventId: randomUUID(), distanceId: randomUUID() };
  const results = await withDbSessions(3, async ([first, second, blocker]) => {
    await beginAs(first, userId);
    await beginAs(second, userId);
    const firstResult = await createDistanceOn(first, ids);
    // 関数を変えずに、後の要求を操作の照合と距離IDの確認の間で待たせる。関数がその間で的の表を読むことに依る。
    await blocker.client.query("begin");
    const lock = blocker.client.query(
      "lock table public.target_faces in access exclusive mode",
    );
    lock.catch(() => undefined);
    await expectWaitingForLock(blocker);
    const waiting = createDistanceOn(second, ids);
    await expectWaitingForLock(second);
    await first.client.query("commit");
    await lock;
    await blocker.client.query("commit");
    const secondResult = await waiting;
    await second.client.query("commit");
    return [firstResult, secondResult].map((r) => r.rows[0].result);
  });

  expect(results).toEqual([createdDistance, createdDistance]);
  expect(await distanceCounts(ids.distanceId)).toEqual({
    distances: 1,
    events: 1,
  });
});

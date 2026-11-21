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
import { getOtpCodeFromMailpit, mailIds } from "../helpers/mailpit";
import {
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

test("オフラインで開始したラウンドの詳細からラウンド一覧へ移り、オンラインに戻ると、そのラウンドを開き直さずに保存され、一覧にそのラウンドが1件だけ表示される", async ({
  page,
}) => {
  // オフラインでラウンドを開始し、開いた設定のダイアログを閉じる。
  await page.goto("/rounds/new");
  await waitForHydration(page);
  await waitForServiceWorkerControl(page);
  await expectRoundBasesFetched(page);
  await goOffline(page.context());
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await waitForHydration(page);
  const id = page.url().split("/").pop() as string;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

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

  // ラウンド一覧を読み込み直し、そのラウンドが1件だけ表示されることを確かめる。
  await page.reload();
  await waitForHydration(page);
  await expect(roundLinks(page, id)).toHaveCount(1);
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

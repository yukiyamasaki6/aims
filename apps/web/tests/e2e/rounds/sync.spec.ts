import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { expectKeypadSettled } from "../helpers/keypad";
import {
  disableRound,
  forwardAs,
  getDistanceIds,
  getLiveDistances,
  getLiveShots,
  getRoundRow,
  goOnline,
  openOtherDevice,
  recordShot,
  savedRoundCount,
  updateRound,
} from "../helpers/other-device";
import { expectRoundBasesFetched } from "../helpers/reference-data";
import {
  createRound,
  expectNoSyncStatus,
  signInAsTestUser,
} from "../helpers/rounds";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { overlapNextRefresh } from "../helpers/session-overlap";
import { mockTurnstile } from "../helpers/turnstile";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const UPDATE_ROUND_RPC = "**/rest/v1/rpc/update_round";
const RECORD_SHOTS_RPC = "**/rest/v1/rpc/record_shots";
const CREATE_ROUND_RPC = "**/rest/v1/rpc/create_round";

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

// エンドの記録済みの玉(点数の高い順)。
function endBalls(page: Page, distance: number, end: number) {
  return page
    .getByTestId(`end-row-${distance}-${end}`)
    .locator("[data-shot-id]");
}

// ラウンド名を変更して保存する。保存は操作の列に積まれ、update_round RPCで送信される。
async function saveRoundName(page: Page, name: string) {
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill(name);
  await page.getByTestId("round-config-save").click();
}

async function reloadRound(page: Page) {
  await page.reload();
  await waitForHydration(page);
}

// 保存された生きている矢を「エンド:点数」の配列で、文字列の順に返す。
async function savedShots(supabase: SupabaseClient, distanceId: string) {
  const { data, error } = await supabase
    .from("shots")
    .select("end_number, score_str")
    .eq("distance_id", distanceId)
    .is("disabled_at", null);
  if (error) throw error;
  return data.map((shot) => `${shot.end_number}:${shot.score_str}`).sort();
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
  await page.getByRole("link", { name: "一覧へ戻る" }).click();
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
  await page.getByPlaceholder("パスワード").fill(user.password);
  const signInButton = page.getByRole("button", { name: "サインイン" });
  await expect(signInButton).toHaveAttribute("data-captcha-ready", "true");
  await signInButton.click();
}

async function signOutOnPage(page: Page) {
  await page.getByRole("button", { name: "サインアウト" }).click();
  await page.getByRole("button", { name: "サインアウトする" }).click();
  await expect(page).toHaveURL(/\/signin/);
  // 水和の前に入力すると、メールアドレス欄が水和で空に戻るため、水和を待つ。
  await waitForHydration(page);
}

// ラウンド作成画面で開始し、作成した詳細画面のラウンドIDを返す。
async function startRoundFromUi(page: Page, presetName?: string) {
  await page.goto("/rounds/new");
  await waitForHydration(page);
  if (presetName) {
    const preset = page
      .getByTestId("round-preset-button")
      .filter({ hasText: presetName });
    await preset.click();
  }
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
  await expect(page.getByTestId("round-summary")).toBeVisible();
  return page.url().split("/").pop() as string;
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
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);
  await expectNoSyncStatus(page);

  // 送信を通し、点数が保存された後も同期の状態が表示されないことを確かめる。
  releaseRequest();
  await expectSavedShots(device.supabase, distanceId, ["1:10"]);
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
  await page.getByTestId("shot-ball-1-1-1").click();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);
  await page.getByTestId("score-button-clear").click();
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await saveRoundName(page, "オンライン復帰テスト");
  await expect(page.getByTestId("round-config-summary")).toContainText(
    "オンライン復帰テスト",
  );

  // オンラインに戻り、操作なしで名前と最後の点数だけが保存されることを確かめる。
  // ページの再読み込みや再訪問をせず、オンライン復帰のイベントだけで送らせる。
  await goOnline(page);
  await expect
    .poll(async () => (await getRoundRow(device.supabase, roundId)).name, {
      timeout: 15_000,
    })
    .toBe("オンライン復帰テスト");
  await expectSavedShots(device.supabase, distanceId, ["1:9"]);

  // 再読み込みし、最後の点数だけが表示されることを確かめる。
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
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
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);

  await backToList(page);

  // オンラインに戻り、そのラウンドを開き直さずに点数が保存されることを確かめる。
  await goOnline(page);
  await expectSavedShots(supabase, distanceIds[0], ["1:10"]);
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
  await expectSavedShots(supabase, distanceIds[0], ["1:10"]);
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

test("ラウンドの作成の送信が失敗している間に距離を追加して点数を記録し、送信が回復すると、再読み込みしても、ラウンド・距離・点数が表示される", async ({
  page,
}) => {
  let attempts = 0;
  let failing = true;
  await page.route(CREATE_ROUND_RPC, async (route) => {
    attempts++;
    if (failing) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.clock.install();
  const id = await startRoundFromUi(page, "WA 1440");
  await expect.poll(() => attempts).toBeGreaterThan(0);

  // リトライを待つ間に、距離を追加して点数を記録する。
  await page.getByTestId("add-distance-button").click();
  await page.getByTestId("distance-config-save-5").click();
  await page.getByTestId("end-blank-5-1").click();
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 5, 1)).toHaveText(["9"]);

  // 作成の送信を回復させ、作成が再送されるまで時間を進める。
  // 点数の記録は、作成の確定の後に送られる。
  const sent = page.waitForResponse(
    (r) => r.url().includes("/rpc/record_shots") && r.ok(),
  );
  const attemptsBeforeRecovery = attempts;
  failing = false;
  // リトライ待機（3秒から倍に伸びる）の実待機を避けるため、作成が再送されるまでページのタイマーを1秒ずつ進める。
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1_000);
        return attempts;
      },
      { intervals: [200], timeout: 15_000 },
    )
    .toBeGreaterThan(attemptsBeforeRecovery);

  // 点数の保存を待って再読み込みし、ラウンド・距離・点数が表示され、ラウンドが保存されていることを確かめる。
  await sent;
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-5")).toBeVisible();
  await expect(endBalls(page, 5, 1)).toHaveText(["9"]);
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  expect(await savedRoundCount(supabase, id)).toBe(1);
});

test("ラウンドの作成の送信が失敗し続けている間に点数を記録すると、再読み込みしても、ラウンドと点数が表示される", async ({
  page,
}) => {
  let attempts = 0;
  await page.route(CREATE_ROUND_RPC, (route) => {
    attempts++;
    return route.abort("failed");
  });
  const id = await startRoundFromUi(page, "WA 1440");
  await expect.poll(() => attempts).toBeGreaterThan(0);

  // エンド1へ点数を記録する。
  // 開いた時点でエンド1の新しい矢を指してテンキーが開いているため、空白は押さずに入力する。
  await page.getByTestId("score-button-10").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);

  // 再読み込みし、サーバーにラウンドが無くても、ラウンドと点数が表示されることを確かめる。
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-1")).toContainText("90m");
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  expect(await savedRoundCount(supabase, id)).toBe(0);
});

test("開始したラウンドの作成が、受け付けられない形として拒否されると、「ラウンドが見つかりません。」と表示され、ラウンド一覧にそのラウンドが表示されない", async ({
  page,
}) => {
  // 詳細の表示を確かめてから拒否を返すため、作成の応答を止めておく。
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(CREATE_ROUND_RPC, async (route) => {
    await gate;
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ code: "PT422", message: "invalid" }),
    });
  });
  const id = await startRoundFromUi(page);

  // 作成の拒否を返し、「ラウンドが見つかりません。」と表示されることを確かめる。
  release();
  await expect(page.getByText("ラウンドが見つかりません。")).toBeVisible();

  await backToList(page);
  await expect(roundLinks(page, id)).toHaveCount(0);
});

test("オンラインで送信の失敗が5回続いても、失敗を知らせる表示は出ず、送信が成功するようになると、操作なしで名前が保存される", async ({
  page,
}) => {
  // 送信が5回失敗する状態でラウンドの名前を保存し、設定のダイアログが閉じるのを待つ。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  let attempts = 0;
  await page.route(UPDATE_ROUND_RPC, async (route) => {
    attempts++;
    if (attempts <= 5) {
      await route.fulfill({ status: 500, body: "temporary error" });
      return;
    }
    await route.continue();
  });
  await openRound(page);
  // リトライ待機（3・6・12・24・48秒）の実待機を避けるため、1秒刻みでページのタイマーを進める。
  await page.clock.install();
  await saveRoundName(page, "失敗が続いた後の再送");
  // 保存で閉じた設定のダイアログを、失敗を知らせる表示と数えないよう、閉じ終わるのを待つ。
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 時間を進めて、5回の失敗の後に送信を成功させ、その間に失敗を知らせる表示が出ず、名前が保存されることを確かめる。
  const notices: number[] = [];
  for (let i = 0; i < 150 && attempts < 6; i++) {
    await page.clock.runFor(1_000);
    notices.push(
      (await page.getByRole("dialog").count()) +
        (await page.getByText("同期失敗").count()),
    );
  }
  expect(attempts).toBe(6);
  await expect
    .poll(async () => (await getRoundRow(device.supabase, roundId)).name, {
      timeout: 15_000,
    })
    .toBe("失敗が続いた後の再送");
  expect(notices.every((count) => count === 0)).toBe(true);
});

test("点数の送信が失敗してリトライを待つ間に同じ矢の点数を直し、通信が回復した状態で再読み込みすると、直した点数が保存され、再読み込みしても先の点数に戻らない", async ({
  page,
}) => {
  // 点数の送信が失敗する状態で10を記録し、リトライを待つ間に同じ矢を9へ直す。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  let attempts = 0;
  // オフラインのままの再読み込みはService Workerの/offlineへ遷移するため、通信の失敗はルートの中断で再現する。
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    attempts++;
    await route.abort("failed");
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await page.getByTestId("shot-ball-1-1-1").click();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);

  // 通信を回復させて再読み込みし、直した点数が保存されて表示されることを確かめる。
  await page.unroute(RECORD_SHOTS_RPC);
  await reloadRound(page);
  await expectSavedShots(device.supabase, distanceId, ["1:9"]);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);

  // もう一度再読み込みし、先の点数に戻らないことを確かめる。
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
});

test("受け付けられない形で送られた点数が拒否されても、同じエンドへ記録し直した点数と別のエンドの点数は保存され、再読み込みしても表示される", async ({
  page,
}) => {
  // 10の記録がサーバーに拒否され、点数が消えることを確かめる。
  const device = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  const [distanceId] = await getDistanceIds(device.supabase, roundId);
  let rejectedStatus = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    const shots = route.request().postDataJSON().p_shots as {
      score_str: string;
    }[];
    if (shots.some((s) => s.score_str === "10")) {
      // 実サーバーへ、契約に反する形（score_strなし）で送り、その応答を返す。
      rejectedStatus = await forwardAs(route, device.supabase, (body) => ({
        p_shots: (body as { p_shots: Record<string, unknown>[] }).p_shots.map(
          ({ score_str: _omitted, ...rest }) => rest,
        ),
      }));
      return;
    }
    await route.continue();
  });
  await openRound(page);
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => rejectedStatus).toBe(422);
  await expect(endBalls(page, 1, 1)).toHaveCount(0);

  // エンド1へ9を記録し直し、エンド2へ8を記録して、再読み込みし、両方が保存されて表示されることを確かめる。
  const secondSaved = page.waitForResponse(
    (response) =>
      response.url().includes("/rpc/record_shots") &&
      response.ok() &&
      (response.request().postData() ?? "").includes('"score_str":"8"'),
  );
  await page.getByTestId("end-blank-1-1").click();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);
  await page.getByTestId("score-button-9").click();
  await page.getByTestId("end-blank-1-2").click();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);
  await page.getByTestId("score-button-8").click();
  await secondSaved;
  await reloadRound(page);
  await expectSavedShots(device.supabase, distanceId, ["1:9", "2:8"]);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await expect(endBalls(page, 1, 2)).toHaveText(["8"]);
});

test("2つのラウンドに未送信の点数があり、一方の送信が失敗し続けていても、もう一方のラウンドの点数は保存される", async ({
  page,
}) => {
  // 送信を止めた状態で、送信が失敗し続けるラウンドに点数を記録する。
  const email = getSharedEmail();
  const failing = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("失敗し続ける"),
  );
  const other = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("もう一方"),
  );
  let otherBlocked = true;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    const body = route.request().postData() ?? "";
    if (otherBlocked || body.includes(failing.distanceId)) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.goto(`/rounds/${failing.id}`);
  await waitForHydration(page);
  await page.getByTestId("score-button-10").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);

  await backToList(page);

  await openFromList(page, other.name);

  // もう一方のラウンドに点数を記録する。
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);

  // もう一方のラウンドの送信だけを通し、リトライ待機の後に、その点数だけが保存されることを確かめる。
  otherBlocked = false;
  await expectSavedShots(other.supabase, other.distanceId, ["1:9"]);
  expect(await savedShots(failing.supabase, failing.distanceId)).toEqual([]);
});

test("3つのラウンドに未送信の点数があり、1つが権限の無い操作として拒否されると、拒否された点数だけが消え、他の2つのラウンドの点数は保存される", async ({
  page,
}) => {
  // 送信を止めた状態で、1つ目のラウンドに点数を記録する。
  const email = getSharedEmail();
  const first = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("1つ目"),
  );
  const rejected = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("拒否される"),
  );
  const third = await createNamedRound(
    email,
    SHARED_PASSWORD,
    uniqueName("3つ目"),
  );
  const outsider = {
    email: `outsider-${randomUUID()}@example.com`,
    password: "password-e2e-outsider",
  };
  await createConfirmedUser(outsider);
  const outsiderDevice = await openOtherDevice(
    outsider.email,
    outsider.password,
  );
  let blocked = true;
  let rejectedStatus = 0;
  // 拒否されるラウンドの点数だけを、ラウンドの参加者でないユーザーとして実サーバーへ送り、認可で拒否させる。
  await page.route(RECORD_SHOTS_RPC, async (route: Route) => {
    const body = route.request().postData() ?? "";
    if (blocked) {
      await route.abort("failed");
      return;
    }
    if (body.includes(rejected.distanceId)) {
      rejectedStatus = await forwardAs(route, outsiderDevice.supabase);
      return;
    }
    await route.continue();
  });
  await page.goto(`/rounds/${first.id}`);
  await waitForHydration(page);
  await page.getByTestId("score-button-10").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["10"]);

  await backToList(page);

  await openFromList(page, rejected.name);

  // 拒否されるラウンドに点数を記録する。
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);

  await backToList(page);

  await openFromList(page, third.name);

  // 3つ目のラウンドに点数を記録する。
  await page.getByTestId("score-button-8").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["8"]);

  // 送信の止めを解き、拒否された点数だけが消え、他の2つのラウンドの点数が保存されることを確かめる。
  blocked = false;
  // 止めを解いた時点で、リトライ待機中の送信をすぐ試させる。
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expectSavedShots(first.supabase, first.distanceId, ["1:10"]);
  await expectSavedShots(third.supabase, third.distanceId, ["1:8"]);
  await expect.poll(() => rejectedStatus).toBe(403);
  expect(await savedShots(rejected.supabase, rejected.distanceId)).toEqual([]);

  await backToList(page);

  await openFromList(page, rejected.name);
  await expect(endBalls(page, 1, 1)).toHaveCount(0);
});

test("サインインが切れて送れなかった点数は、ラウンド一覧にいるままサインインし直すと、そのラウンドを開き直さずに保存される", async ({
  page,
  context,
}) => {
  // 送信が失敗する状態で点数を記録する。
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
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

  // サインインを切って通信を戻し、サインイン画面へ移るのを待つ。
  await context.clearCookies();
  await page.unroute(RECORD_SHOTS_RPC);
  // 再送は、サインインが切れているため、未認証で保留になる。同じ契機で、セッションの喪失を検知した共通のガードがサインイン画面へ移す。
  // テストからサインイン画面を開くと、ガードの遷移と競合して中断されるため、ガードの遷移を待つ。
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page).toHaveURL(/\/signin$/);
  await waitForHydration(page);

  // サインインし直してラウンド一覧へ戻り、そのラウンドを開き直さずに点数が保存されることを確かめる。
  await signInOnPage(page, {
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
  });
  await expect(page).toHaveURL(/\/rounds$/);
  await expectSavedShots(supabase, distanceIds[0], ["1:10"]);
});

// セッションの更新はリフレッシュトークンを入れ替え、共有のユーザーの他のテストのセッションを無効にし得るため、使い捨てのユーザーで行う。
test.describe("セッションの更新の重なり", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("ラウンドの詳細で、セッションの更新が別の書き手の更新と重なっても、記録した点数は保存される", async ({
    page,
  }) => {
    // 使い捨てのユーザーでサインインし、ラウンドの詳細を開く。
    const credentials = {
      email: `e2e-sync-overlap-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`,
      password: "password-e2e-sync",
    };
    await signUpAndSignIn(page, credentials);
    const ownRoundId = await createRound({
      ...credentials,
      name: "重なりテスト",
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    });
    const device = await openOtherDevice(
      credentials.email,
      credentials.password,
    );
    const [distanceId] = await getDistanceIds(device.supabase, ownRoundId);
    await page.goto(`/rounds/${ownRoundId}`);
    await waitForHydration(page);
    await expect(page.getByTestId("score-button-10")).toBeVisible();

    // 次のセッションの更新を別の書き手の更新と重ねて点数を記録し、点数が保存されることを確かめる。
    const { overlapped } = await overlapNextRefresh(page);
    await page.getByTestId("score-button-10").click();
    await overlapped;
    await expectSavedShots(device.supabase, distanceId, ["1:10"]);
  });
});

test("別の利用者の未送信の点数が残る端末でサインインして点数を記録しても、別の利用者の点数は送られず、表示されず、その利用者が再びサインインすると保存される", async ({
  page,
  context,
}) => {
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
  // 利用者Aの点数の送信は、利用者Bの間も、利用者Aが再びサインインするまで失敗させ続け、試行の回数を数える。
  let blockA = true;
  let attemptsOfA = 0;
  await page.route(RECORD_SHOTS_RPC, async (route) => {
    const isA = (route.request().postData() ?? "").includes(roundA.distanceId);
    if (isA) attemptsOfA++;
    if (isA && blockA) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.goto("/signin");
  await waitForHydration(page);
  await signInOnPage(page, userA);
  await expect(page).toHaveURL(/\/rounds$/);

  await openFromList(page, roundA.name);

  // 利用者Aのラウンドで、送信が失敗する状態で点数を記録する。
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attemptsOfA).toBeGreaterThan(0);

  await signOutOnPage(page);

  // 利用者Bでサインインする。
  const attemptsBeforeB = attemptsOfA;
  await signInOnPage(page, userB);
  await expect(page).toHaveURL(/\/rounds$/);

  await openFromList(page, roundB.name);

  // 利用者Bのラウンドで点数を記録して保存されるのを確かめ、利用者Aの点数が送られず、保存されていないことを確かめる。
  await page.getByTestId("score-button-9").click();
  await expectSavedShots(roundB.supabase, roundB.distanceId, ["1:9"]);
  expect(attemptsOfA).toBe(attemptsBeforeB);
  expect(await savedShots(roundA.supabase, roundA.distanceId)).toEqual([]);

  await backToList(page);
  await expect(page.getByText(roundA.name)).toHaveCount(0);

  await signOutOnPage(page);

  // 利用者Aの送信の失敗を解いてサインインし直し、利用者Aの点数が保存されることを確かめる。
  blockA = false;
  await signInOnPage(page, userA);
  await expectSavedShots(roundA.supabase, roundA.distanceId, ["1:10"]);
});

test("他の端末の矢がある距離で、オフラインで距離(m)とエンド数・矢数を同じ保存で変えると、オンラインに戻った後、その矢が収まらないエンド数・矢数は元のままで、距離(m)は変わり、他の端末の矢が残る", async ({
  page,
}) => {
  // 6エンド×6射の距離を、オフラインで40m・12エンド×3射へ変えて保存する。
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 6, arrowsPerEnd: 6 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-distance-1").fill("40");
  await page.getByTestId("distance-config-total-ends-1").fill("12");
  await page.getByTestId("distance-config-arrows-1").fill("3");
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByTestId("distance-config-save-1")).toBeHidden();
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "3本×12エンド",
  );

  // 他の端末がエンド1へ5本を記録した後でオンラインに戻り、距離(m)だけが保存されることを確かめる。
  for (const score of [10, 9, 8, 7, 6]) {
    await recordShot(supabase, {
      distanceId: distanceIds[0],
      endNumber: 1,
      scoreStr: String(score),
      scoreInt: score,
    });
  }
  await goOnline(page);
  await expect
    .poll(
      async () => {
        const [distance] = await getLiveDistances(supabase, roundId);
        return {
          distance: distance?.distance,
          total_ends: distance?.total_ends,
          arrows_per_end: distance?.arrows_per_end,
        };
      },
      { timeout: 15_000 },
    )
    .toEqual({ distance: 40, total_ends: 6, arrows_per_end: 6 });

  // 再読み込みし、元のエンド数・矢数と変えた距離(m)で、他の端末の5本が表示されることを確かめる。
  await reloadRound(page);
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    "6本×6エンド",
  );
  await expect(page.getByTestId("distance-summary-1")).toContainText("40m");
  await expect(endBalls(page, 1, 1)).toHaveText(["10", "9", "8", "7", "6"]);
});

test("他の端末がラウンドの名前と日付を、この端末がオフラインで名前と弓種を変えると、オンラインに戻った後、名前は後に保存されたこの端末の値になり、日付と弓種は両方の変更が残る", async ({
  page,
}) => {
  // オフラインで名前と弓種を変えて保存する。
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("round-config-summary").click();
  await page.getByTestId("round-config-name").fill("ページ側の名前");
  await page.getByTestId("round-config-bow-type-compound").click();
  await page.getByTestId("round-config-save").click();
  await expect(page.getByTestId("round-config-save")).toBeHidden();

  // 他の端末が名前と日付を変えた後でオンラインに戻り、名前はこの端末の値で、日付と弓種は両方の変更で保存されることを確かめる。
  await updateRound(supabase, roundId, {
    name: "他端末の名前",
    round_date: "2026-08-25",
  });
  await goOnline(page);
  await expect
    .poll(
      async () => {
        const row = await getRoundRow(supabase, roundId);
        return {
          name: row.name,
          bow_type: row.bow_type,
          round_date: row.round_date,
        };
      },
      { timeout: 15_000 },
    )
    .toEqual({
      name: "ページ側の名前",
      bow_type: "compound",
      round_date: "2026-08-25",
    });

  // 再読み込みし、保存された名前・日付・弓種が表示されることを確かめる。
  await reloadRound(page);
  await expect(page.getByTestId("round-config-summary")).toHaveText(
    "ページ側の名前 / 2026-08-25 / アウトドア / コンパウンド",
  );
});

test("2つの端末がオフラインで、同じ矢数6のエンドへ4本ずつ記録すると、オンラインに戻った後、先に保存された6本が別々の矢として残り、両方の端末で再読み込みしても6本で、知らせる表示は出ない", async ({
  page,
  browser,
}) => {
  // 2つの端末で同じラウンドを開いてオフラインにし、同じエンドへ4本ずつ記録する。
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 6, arrowsPerEnd: 6 }],
  });
  const secondContext = await browser.newContext({
    storageState: SHARED_AUTH_STATE_PATH,
  });
  const second = await secondContext.newPage();
  try {
    await openRound(page);
    await second.goto(`/rounds/${roundId}`);
    await waitForHydration(second);
    await page.context().setOffline(true);
    await secondContext.setOffline(true);
    for (let i = 0; i < 4; i++) {
      await page.getByTestId("score-button-10").click();
      await second.getByTestId("score-button-5").click();
    }
    await expect(endBalls(page, 1, 1)).toHaveCount(4);
    await expect(endBalls(second, 1, 1)).toHaveCount(4);

    // この端末がオンラインに戻り、4本が保存されることを確かめる。
    const pageSent = page.waitForResponse(RECORD_SHOTS_RPC);
    await goOnline(page);
    await pageSent;
    await expectSavedShots(supabase, distanceIds[0], [
      "1:10",
      "1:10",
      "1:10",
      "1:10",
    ]);

    // もう1つの端末がオンラインに戻り、先に保存された6本が別々の矢として表示され、知らせる表示が出ないことを確かめる。
    // 4本は同じ距離の1つの要求にまとまる。
    const secondSent = second.waitForResponse(RECORD_SHOTS_RPC);
    await goOnline(second);
    await secondSent;
    await expect(endBalls(second, 1, 1)).toHaveText([
      "10",
      "10",
      "10",
      "10",
      "5",
      "5",
    ]);
    await expect(second.getByRole("dialog")).toHaveCount(0);
    await expect(second.getByText("同期失敗")).toHaveCount(0);
    expect(await savedShots(supabase, distanceIds[0])).toEqual([
      "1:10",
      "1:10",
      "1:10",
      "1:10",
      "1:5",
      "1:5",
    ]);
    const saved = await getLiveShots(supabase, distanceIds[0]);
    expect(new Set(saved.map((shot) => shot.id)).size).toBe(6);

    // 両方の端末で再読み込みし、6本が表示されることを確かめる。
    for (const device of [page, second]) {
      await reloadRound(device);
      await expect(endBalls(device, 1, 1)).toHaveCount(6);
    }
  } finally {
    await secondContext.close();
  }
});

test("射手をこの端末の利用者として記録した矢を、オンラインで直すと、点数だけが変わって射手が残り、射手は送られない", async ({
  page,
}) => {
  const { supabase, userId, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  // ラウンドに別の利用者を加える経路が無いため、射手はラウンドの利用者とし、この端末が射手を送らないことと、射手が残ることを確かめる。
  const shooterId = userId;
  const shotId = await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "5",
    scoreInt: 5,
    shooterId,
  });
  const sentBodies: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/rpc/record_shots")) {
      sentBodies.push(request.postData() ?? "");
    }
  });
  await openRound(page);
  await page.getByTestId("shot-ball-1-1-1").click();
  await page.getByTestId("score-button-9").click();
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);

  await expect
    .poll(() => getLiveShots(supabase, distanceIds[0]), { timeout: 15_000 })
    .toEqual([
      {
        id: shotId,
        end_number: 1,
        score_str: "9",
        shooter_id: shooterId,
        shot_number: null,
      },
    ]);
  expect(sentBodies.length).toBeGreaterThan(0);
  for (const body of sentBodies) expect(body).not.toContain("shooter_id");
});

test("他の端末がラウンドを削除した後に、この端末がオフラインで記録した点数と変えた名前が送られても、どれも表示されず、ラウンドが見つからない表示になる", async ({
  page,
}) => {
  // オフラインで点数を記録し、ラウンドの名前を保存する。
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await openRound(page);
  await page.context().setOffline(true);
  await page.getByTestId("score-button-8").click();
  await saveRoundName(page, "削除後の名前");
  await expect(page.getByTestId("round-config-summary")).toContainText(
    "削除後の名前",
  );

  // 他の端末が点数を記録してラウンドを削除した後でオンラインに戻り、この端末の操作が送られた後に再読み込みして、ラウンドが見つからない表示になることを確かめる。
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "9",
    scoreInt: 9,
  });
  await disableRound(supabase, roundId);
  const sent = page.waitForResponse(UPDATE_ROUND_RPC);
  const shotsSent = page.waitForResponse(RECORD_SHOTS_RPC);
  await goOnline(page);
  await sent;
  await shotsSent;
  await page.reload();
  await expect(page.getByText("ラウンドが見つかりません。")).toBeVisible();
});

test("2つのタブで、同期済みの同じ矢を、オフラインで一方のタブが直し、他方のタブが後に消すと、オンラインに戻った後、後に行った消去の結果が保存される", async ({
  page,
  context,
}) => {
  // 同期済みの5の矢があるラウンドを2つのタブで開き、オフラインで一方のタブでその矢を10へ直し、他方のタブに反映されるのを確かめる。
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 1,
    scoreStr: "5",
    scoreInt: 5,
  });
  const other = await context.newPage();
  await openRound(page);
  await other.goto(`/rounds/${roundId}`);
  await waitForHydration(other);
  await context.setOffline(true);
  // 背面のタブはアニメーションが進まず、操作の「安定」を待ち続けるため、操作するタブを前面にする。
  await page.bringToFront();
  await page.getByTestId("shot-ball-1-1-1").click();
  // 閉じたテンキーを開き直す動きが終わってから押す。
  await expectKeypadSettled(page);
  await page.getByTestId("score-button-10").click();
  await expect(endBalls(other, 1, 1)).toHaveText(["10"]);

  // 他方のタブでその矢を消し、一方のタブからも消えるのを確かめる。
  await other.bringToFront();
  await other.getByTestId("shot-ball-1-1-1").click();
  await other.getByTestId("score-button-clear").click();
  await expect(endBalls(page, 1, 1)).toHaveCount(0);

  // オンラインに戻り、消去の結果が保存され、再読み込みしても表示されないことを確かめる。
  await context.setOffline(false);
  await goOnline(page);
  await goOnline(other);
  // 初めは5が保存されているため、消去の確定で空になる。
  await expectSavedShots(supabase, distanceIds[0], []);
  await reloadRound(page);
  await expect(endBalls(page, 1, 1)).toHaveCount(0);
});

test("送信に失敗して2つのタブに未送信の点数があるとき、一方のタブを閉じると、残ったタブで両方の点数が保存される", async ({
  page,
  context,
}) => {
  // 送信が失敗する状態で、2つのタブで同じエンドへ10と9を記録する。
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  let attempts = 0;
  let failing = true;
  await context.route(RECORD_SHOTS_RPC, async (route) => {
    attempts++;
    if (failing) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const other = await context.newPage();
  await openRound(page);
  await other.goto(`/rounds/${roundId}`);
  await waitForHydration(other);
  await page.bringToFront();
  await page.getByTestId("score-button-10").click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await other.bringToFront();
  await other.getByTestId("end-blank-1-1").click();
  await other.getByTestId("score-button-9").click();
  await expect(endBalls(other, 1, 1)).toHaveText(["10", "9"]);

  // 送信の失敗を解いて一方のタブを閉じ、残ったタブで両方の点数が保存されることを確かめる。
  failing = false;
  await page.close();
  await expectSavedShots(supabase, distanceIds[0], ["1:10", "1:9"]);
});

test("オフラインで点数を記録した入力中のラウンドを、アプリを開き直してオフラインのまま開き、その間に他の端末が別のエンドへ点数を記録すると、オンラインに戻った後、操作なしで両方の点数が表示され、オフラインで記録した点数が保存される", async ({
  profile,
}) => {
  // オンラインでサインインして端末への取得を済ませ、オフラインで点数を記録する。
  const { supabase, distanceIds } = await createSyncRound({
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  const first = await profile.open();
  await signUpAndSignIn(first.page, {
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
  });
  await waitForServiceWorkerControl(first.page);
  await expect(
    first.page.getByTestId("round-base-refresher"),
  ).not.toHaveAttribute("data-refreshed-count", "0");
  await goOffline(first.context);
  await first.page.goto(`/rounds/${roundId}`);
  await waitForHydration(first.page);
  await first.page.getByTestId("score-button-9").click();
  await expect(endBalls(first.page, 1, 1)).toHaveText(["9"]);

  // アプリを閉じて開き直し、オフラインのまま開いて、点数が表示されることを確かめる。
  await profile.close();
  const { context, page } = await profile.open();
  await goOffline(context);
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);

  // 他の端末が別のエンドへ点数を記録した後でオンラインに戻り、操作なしで両方の点数が表示され、保存されることを確かめる。
  await recordShot(supabase, {
    distanceId: distanceIds[0],
    endNumber: 2,
    scoreStr: "5",
    scoreInt: 5,
  });
  await comeBackOnline(context, page);
  await expect(endBalls(page, 1, 2)).toHaveText(["5"]);
  await expect(endBalls(page, 1, 1)).toHaveText(["9"]);
  await expectSavedShots(supabase, distanceIds[0], ["1:9", "2:5"]);
});

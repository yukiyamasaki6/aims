import { randomUUID } from "node:crypto";
import {
  expect,
  type Locator,
  type Page,
  type Response,
  test,
} from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  createConfirmedUser,
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import {
  blockOpLogStore,
  expectNoPendingOps,
  expectOpsSaved,
} from "../helpers/op-log";
import { forwardAs, openOtherDevice } from "../helpers/other-device";
import {
  expectRoundBasesFetched,
  openNewRoundThenGoOffline,
  startRoundOffline,
} from "../helpers/reference-data";
import { createRound, signInAsTestUser } from "../helpers/rounds";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

const roundsText = translatorFor("rounds");

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const DISABLE_ROUND_RPC = "**/rest/v1/rpc/disable_round";

// 共有ユーザーのホームは他のテストのラウンドも含むため、名前を一意にして行を特定する。
async function createNamedRound(prefix: string) {
  const name = `${prefix}-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  return { name, roundId };
}

async function openList(page: Page, name: string, roundId: string) {
  await page.goto("/rounds");
  await waitForHydration(page);
  // 入力中の区画は端末の保存から読むため、一括の取得の反映を待ってから操作する(区画へ移ると、開いたメニューが作り直される)。
  await expectRoundBasesFetched(page, { roundId });
  return {
    row: page.locator("li", { hasText: name }),
    link: page.getByRole("link", { name: new RegExp(name) }),
  };
}

// メニューを開き、削除を選ぶ。メニューの項目と確認ダイアログは画面の最上位に描かれるため、pageから探す。
async function chooseDelete(page: Page, scope: Page | Locator = page) {
  await scope.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
}

// 削除のRPCを、解放するまで完了させない。
async function holdDeleteRequest(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(DISABLE_ROUND_RPC, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

// 復帰後に、削除がサーバーへ届いたことを確かめる。
async function expectDeletedOnServer(roundId: string) {
  const { supabase } = await signInAsTestUser(
    getSharedEmail(),
    SHARED_PASSWORD,
  );
  await expect
    .poll(
      async () => {
        const { data } = await supabase
          .from("rounds")
          .select("disabled_at")
          .eq("id", roundId);
        return data?.[0]?.disabled_at ?? null;
      },
      { timeout: 15_000 },
    )
    .not.toBeNull();
}

test("ホームでカードのメニューから削除を選んで確認すると、確認ダイアログが閉じ、ラウンドがホームから消える", async ({
  page,
}) => {
  // カードのメニューを開き、削除を選べることを確かめる。
  const { name, roundId } = await createNamedRound("ホームから削除");
  const { row, link } = await openList(page, name, roundId);
  await expect(page.getByTestId("round-delete")).toBeHidden();
  await row.getByTestId("round-menu-trigger").click();
  await expect(page.getByTestId("round-delete")).toBeVisible();

  // 削除を選び、確認ダイアログが開くことを確かめる。
  await page.getByTestId("round-delete").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeVisible();

  // 確認し、ダイアログが閉じてラウンドがホームから消えることを確かめる。
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(link).toBeHidden();
});

test("ラウンド詳細のヘッダーのメニューから削除を選んで確認すると、ホームへ移ってラウンドが表示されず、ブラウザの戻るで削除したラウンドの詳細へ戻らない", async ({
  page,
}) => {
  // ホームからラウンドの詳細を開く。
  const { name, roundId } = await createNamedRound("詳細から削除");
  const { link } = await openList(page, name, roundId);
  // 戻る先の履歴を作るため、詳細はホームから開く。
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}$`));

  // ヘッダーのメニューを開き、ラウンドの削除を選べることを確かめる。
  await page.getByTestId("round-menu-trigger").click();
  await expect(page.getByTestId("round-delete")).toBeVisible();

  // ラウンドの削除を選び、確認ダイアログが開くことを確かめる。
  await page.getByTestId("round-delete").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  // 確認し、ホームへ移ってラウンドが表示されないことを確かめる。
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(link).toBeHidden();

  // ブラウザの戻るを押し、削除したラウンドの詳細でなく、最初に開いたホームへ戻ることを確かめる。
  await page.goBack();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(link).toBeHidden();
});

test("オフラインのホームで削除を確認すると、ダイアログがすぐ閉じてラウンドがホームから消え、オンラインに戻った後に再読み込みしても表示されない", async ({
  page,
}) => {
  // オフラインのホームで削除を選んで確認し、ダイアログがすぐ閉じてラウンドがホームから消えることを確かめる。
  const { name, roundId } = await createNamedRound("オフライン一覧削除");
  const { row, link } = await openList(page, name, roundId);
  await expect(link).toBeVisible();
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await chooseDelete(page, row);
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(link).toBeHidden();

  // オンラインに戻り、削除がサーバーへ届いた後に再読み込みしても、ラウンドが表示されないことを確かめる。
  await comeBackOnline(page.context(), page);
  await expectDeletedOnServer(roundId);
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
  await expect(link).toBeHidden();
});

test("オフラインで開始したラウンドの詳細で、オフラインのまま削除を確認するとホームへ移り、オンラインに戻った後に再読み込みしても表示されない", async ({
  page,
}) => {
  // オフラインでラウンドを開始し、開いた設定ダイアログを閉じる。
  await openNewRoundThenGoOffline(page);
  await startRoundOffline(page);
  const roundId = page.url().split("/").pop() ?? "";
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // ヘッダーのメニューから削除を選んで確認し、ホームへ移ることを確かめる。
  await chooseDelete(page);
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page).toHaveURL(/\/rounds$/);

  // オンラインに戻り、削除がサーバーへ届いた後に再読み込みしても、ラウンドが表示されないことを確かめる。
  await comeBackOnline(page.context(), page);
  await expectDeletedOnServer(roundId);
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
  await expect(page.locator(`a[href="/rounds/${roundId}"]`)).toHaveCount(0);
});

test("削除の送信が終わる前にホームを再読み込みしても、削除したラウンドは表示されない", async ({
  page,
}) => {
  // 削除の送信を止めたホームで削除を選んで確認し、ラウンドがホームから消えることを確かめる。
  const { name, roundId } = await createNamedRound("送信前に再読み込み");
  const { row, link } = await openList(page, name, roundId);
  const release = await holdDeleteRequest(page);
  await chooseDelete(page, row);
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(link).toBeHidden();

  // 再読み込みし、ラウンドが表示されないことを確かめる。
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
  await expect(link).toBeHidden();

  release();
});

test("削除する権限が無く削除が拒否されたときは、ホームを再読み込みするとラウンドが再び表示され、エラーメッセージは表示されない", async ({
  page,
}) => {
  // 別のユーザーの権限で削除が送られるホームで削除を選んで確認し、拒否されて操作の列から破棄されるのを待つ。
  const { name, roundId } = await createNamedRound("認可で拒否");
  const outsider = {
    email: `outsider-${randomUUID()}@example.com`,
    password: "password-e2e-outsider",
  };
  await createConfirmedUser(outsider);
  const outsiderDevice = await openOtherDevice(
    outsider.email,
    outsider.password,
  );
  let rejectedStatus = 0;
  // 認可で拒否させるため、削除の要求を別のユーザーの権限で送る。
  await page.route(DISABLE_ROUND_RPC, async (route) => {
    rejectedStatus = await forwardAs(route, outsiderDevice.supabase);
  });
  const { row, link } = await openList(page, name, roundId);
  await chooseDelete(page, row);
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect.poll(() => rejectedStatus).toBe(403);
  await expectNoPendingOps(page, roundId);

  // 再読み込みし、ラウンドが再び表示され、エラーメッセージが表示されないことを確かめる。
  await page.reload();
  await waitForHydration(page);
  await expect(link).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveCount(0);
});

test("端末の保存が終わらない間にラウンド詳細で削除を確認すると、保存が終わるまで詳細に留まり、保存が終わるとホームへ移る", async ({
  page,
}) => {
  // 詳細を開き、端末の保存を塞いだ状態で削除を確認する。
  const { name, roundId } = await createNamedRound("保存待ちの削除");
  const { link } = await openList(page, name, roundId);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}$`));
  const release = await blockOpLogStore(page);
  await chooseDelete(page);
  await page.getByTestId("confirm-dialog-confirm").click();

  // 確認ダイアログが閉じるが、まだ移らないことを確かめる。
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}$`));

  // 塞ぎを解き、保存の後にホームへ移ることを確かめる。
  await release();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(link).toBeHidden();
});

// 一括の取得(入力中のラウンドと保持するラウンドを取る)の応答。
function isBulkRoundsResponse(response: Response) {
  return decodeURIComponent(response.url()).includes("status.eq.in_progress");
}

// アプリ内でホームを離れて戻る。ホームは戻るたびに端末の保存から作り直され、取得は呼ばない。
async function leaveListAndComeBack(page: Page) {
  await page.getByTestId("new-round-fab").click();
  await expect(page).toHaveURL(/\/rounds\/new$/);
  await page.getByRole("link", { name: roundsText("back") }).click();
  await expect(page).toHaveURL(/\/rounds$/);
}

test("別の端末が先に削除したラウンドを、この端末がオフラインで削除してオンラインに戻ると、送信が効かなかった扱いになっても、ホームを離れて戻ったときにそのラウンドは再表示されない", async ({
  page: deviceA,
  browser,
  baseURL,
}) => {
  // 2つの端末で、同じ利用者のホームに削除するラウンドと残すラウンドを表示する。
  const target = await createNamedRound("二重削除");
  const kept = await createNamedRound("二重削除の残り");
  const contextB = await browser.newContext({
    storageState: SHARED_AUTH_STATE_PATH,
    // biome-ignore lint/style/useNamingConvention: Playwrightの設定の項目名
    baseURL,
  });
  const deviceB = await contextB.newPage();
  const listA = await openList(deviceA, target.name, target.roundId);
  const listB = await openList(deviceB, target.name, target.roundId);
  await expectRoundBasesFetched(deviceB, { roundId: kept.roundId });
  await waitForServiceWorkerControl(deviceB);

  // 端末Bがオフラインの間に、端末Aが削除してサーバーへ反映する。
  await contextB.setOffline(true);
  await chooseDelete(deviceA, listA.row);
  await deviceA.getByTestId("confirm-dialog-confirm").click();
  await expect(listA.link).toBeHidden();
  await expectDeletedOnServer(target.roundId);

  // 端末Bが、削除を知らずにオフラインで同じラウンドを削除する。
  await chooseDelete(deviceB, listB.row);
  await deviceB.getByTestId("confirm-dialog-confirm").click();
  await expect(listB.link).toBeHidden();
  await expectOpsSaved(deviceB, target.roundId, 1);

  // オンラインに戻り、削除の送信が効かなかった扱いで操作の列から外れるまで待つ。
  // 復帰の取得を1回に保つため、手動のonlineイベントは足さない(ブラウザが発火するonlineイベントが取得を起こす)。
  await contextB.setOffline(false);
  await expectNoPendingOps(deviceB, target.roundId);

  // ホームを離れて戻っても、削除されたラウンドは再表示されず、残したラウンドは表示される。
  await leaveListAndComeBack(deviceB);
  await expect(
    deviceB.getByRole("link", { name: new RegExp(kept.name) }),
  ).toBeVisible();
  await expect(listB.link).toBeHidden();
  await contextB.close();
});

test("ラウンドの削除が未送信のまま一括の取得が走り、サーバーがそのラウンドをまだ返しても、ホームを離れて戻ったときにそのラウンドは再表示されない", async ({
  page,
}) => {
  // 削除するラウンドと残すラウンドをホームに表示し、削除の送信を止めた状態で削除する。
  const target = await createNamedRound("未送信の削除");
  const kept = await createNamedRound("未送信の削除の残り");
  const { row, link } = await openList(page, target.name, target.roundId);
  await expectRoundBasesFetched(page, { roundId: kept.roundId });
  const release = await holdDeleteRequest(page);
  await chooseDelete(page, row);
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(link).toBeHidden();
  await expectOpsSaved(page, target.roundId, 1);

  // 削除が届いていないサーバーに対して一括の取得を起こし、その応答を待つ。
  const fetched = page.waitForResponse(isBulkRoundsResponse);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await fetched;

  // ホームを離れて戻っても、削除したラウンドは再表示されず、残したラウンドは表示される。
  await leaveListAndComeBack(page);
  await expect(
    page.getByRole("link", { name: new RegExp(kept.name) }),
  ).toBeVisible();
  await expect(link).toBeHidden();

  // 送信を再開し、削除がサーバーへ届くことを確かめる。
  release();
  await expectDeletedOnServer(target.roundId);
});

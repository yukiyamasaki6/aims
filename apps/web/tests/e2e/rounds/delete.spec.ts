import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  createConfirmedUser,
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { expectNoPendingOps } from "../helpers/op-log";
import { forwardAs, openOtherDevice } from "../helpers/other-device";
import {
  openNewRoundThenGoOffline,
  startRoundOffline,
} from "../helpers/reference-data";
import { createRound, signInAsTestUser } from "../helpers/rounds";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

const DISABLE_ROUND_RPC = "**/rest/v1/rpc/disable_round";

// 共有ユーザーの一覧は他のテストのラウンドも含むため、名前を一意にして行を特定する。
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

async function openList(page: Page, name: string) {
  await page.goto("/rounds");
  await waitForHydration(page);
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

test("ラウンド一覧でカードのメニューから削除を選んで確認すると、確認ダイアログが閉じ、ラウンドが一覧から消える", async ({
  page,
}) => {
  // カードのメニューを開き、削除を選べることを確かめる。
  const { name } = await createNamedRound("一覧から削除");
  const { row, link } = await openList(page, name);
  await expect(page.getByTestId("round-delete")).toBeHidden();
  await row.getByTestId("round-menu-trigger").click();
  await expect(page.getByTestId("round-delete")).toBeVisible();

  // 削除を選び、確認ダイアログが開くことを確かめる。
  await page.getByTestId("round-delete").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeVisible();

  // 確認し、ダイアログが閉じてラウンドが一覧から消えることを確かめる。
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(link).toBeHidden();
});

test("ラウンド詳細のヘッダーのメニューから削除を選んで確認すると、ラウンド一覧へ移ってラウンドが表示されず、ブラウザの戻るで削除したラウンドの詳細へ戻らない", async ({
  page,
}) => {
  // 一覧からラウンドの詳細を開く。
  const { name, roundId } = await createNamedRound("詳細から削除");
  const { link } = await openList(page, name);
  // 戻る先の履歴を作るため、詳細は一覧から開く。
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}$`));

  // ヘッダーのメニューを開き、ラウンドの削除を選べることを確かめる。
  await page.getByTestId("round-menu-trigger").click();
  await expect(page.getByTestId("round-delete")).toBeVisible();

  // ラウンドの削除を選び、確認ダイアログが開くことを確かめる。
  await page.getByTestId("round-delete").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  // 確認し、ラウンド一覧へ移ってラウンドが表示されないことを確かめる。
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(link).toBeHidden();

  // ブラウザの戻るを押し、削除したラウンドの詳細でなく、最初に開いた一覧へ戻ることを確かめる。
  await page.goBack();
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(link).toBeHidden();
});

test("オフラインのラウンド一覧で削除を確認すると、ダイアログがすぐ閉じてラウンドが一覧から消え、オンラインに戻った後に再読み込みしても表示されない", async ({
  page,
}) => {
  // オフラインの一覧で削除を選んで確認し、ダイアログがすぐ閉じてラウンドが一覧から消えることを確かめる。
  const { name, roundId } = await createNamedRound("オフライン一覧削除");
  const { row, link } = await openList(page, name);
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

test("オフラインで開始したラウンドの詳細で、オフラインのまま削除を確認するとラウンド一覧へ移り、オンラインに戻った後に再読み込みしても表示されない", async ({
  page,
}) => {
  // オフラインでラウンドを開始し、開いた設定ダイアログを閉じる。
  await openNewRoundThenGoOffline(page);
  await startRoundOffline(page);
  const roundId = page.url().split("/").pop() ?? "";
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // ヘッダーのメニューから削除を選んで確認し、ラウンド一覧へ移ることを確かめる。
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

test("削除の送信が終わる前に一覧を再読み込みしても、削除したラウンドは表示されない", async ({
  page,
}) => {
  // 削除の送信を止めた一覧で削除を選んで確認し、ラウンドが一覧から消えることを確かめる。
  const { name } = await createNamedRound("送信前に再読み込み");
  const { row, link } = await openList(page, name);
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

test("削除する権限が無く削除が拒否されたときは、一覧を再読み込みするとラウンドが再び表示され、エラーメッセージは表示されない", async ({
  page,
}) => {
  // 別のユーザーの権限で削除が送られる一覧で削除を選んで確認し、拒否されて操作の列から破棄されるのを待つ。
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
  const { row, link } = await openList(page, name);
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

import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
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
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
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

async function openDetail(page: Page, roundId: string) {
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
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

test("delete-01: ラウンドが1件以上あるとき、メニューボタンをクリックすると、メニューが展開される", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("メニュー展開");
  const { row } = await openList(page, name);
  await expect(page.getByTestId("round-delete")).toBeHidden();

  // When
  await row.getByTestId("round-menu-trigger").click();

  // Then
  await expect(page.getByTestId("round-delete")).toBeVisible();
});

test("delete-02: メニューを展開したラウンド一覧のとき、削除ボタンをクリックすると、ラウンド削除確認ダイアログが開く", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("削除ボタン");
  const { row } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();

  // When
  await page.getByTestId("round-delete").click();

  // Then
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();
  await expect(page.getByTestId("confirm-dialog-cancel")).toBeVisible();
});

test("delete-03: 削除が成功するとき、確認ボタンをクリックすると、ダイアログが閉じられ、ラウンドが一覧から消える", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("一覧から削除");
  const { row, link } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then
  await expect(link).toBeHidden();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
});

test("delete-04: メニューボタンをクリックすると、メニューが展開される", async ({
  page,
}) => {
  // Given
  const { roundId } = await createNamedRound("詳細メニュー");
  await openDetail(page, roundId);
  await expect(page.getByTestId("round-delete")).toBeHidden();

  // When
  await page.getByTestId("round-menu-trigger").click();

  // Then
  await expect(page.getByTestId("round-delete")).toBeVisible();
});

test("delete-05: メニューを展開したラウンド詳細画面のとき、削除ボタンをクリックすると、ラウンド削除確認ダイアログが開く", async ({
  page,
}) => {
  // Given
  const { roundId } = await createNamedRound("詳細削除ボタン");
  await openDetail(page, roundId);
  await page.getByTestId("round-menu-trigger").click();

  // When
  await page.getByTestId("round-delete").click();

  // Then
  await expect(
    page.getByText(
      "このラウンドを削除しますか？記録したスコアもすべて失われます。",
    ),
  ).toBeVisible();
});

test("delete-06: 削除が成功するとき、確認ボタンをクリックすると、/roundsへ遷移し、ラウンドが一覧に表示されない", async ({
  page,
}) => {
  // Given
  const { name, roundId } = await createNamedRound("詳細から削除");
  await openDetail(page, roundId);
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeHidden();
});

test("delete-07: メニューを展開したラウンド一覧のとき、外側をクリックすると、メニューが閉じられる", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("外側クリック");
  const { row } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await expect(page.getByTestId("round-delete")).toBeVisible();

  // When
  await page.mouse.click(10, 10);

  // Then
  await expect(page.getByTestId("round-delete")).toBeHidden();
});

test("delete-08: キャンセルボタンをクリックすると、ダイアログが閉じられ、ラウンドが削除されない", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("キャンセル");
  const { row, link } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When
  await page.getByTestId("confirm-dialog-cancel").click();

  // Then
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(link).toBeVisible();
});

test("delete-09: 背景をクリックすると、ダイアログが閉じられ、ラウンドが削除されない", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("背景クリック");
  const { row, link } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeVisible();

  // When
  await page.mouse.click(10, 10);

  // Then
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(link).toBeVisible();
});

test("delete-12: オフラインのラウンド一覧のとき、削除を確認すると、ダイアログがすぐに閉じられ、ラウンドが一覧から消える", async ({
  page,
}) => {
  // Given
  const { name } = await createNamedRound("オフライン一覧削除");
  const { row, link } = await openList(page, name);
  await expect(link).toBeVisible();
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then
  await expect(page.getByTestId("confirm-dialog-confirm")).toBeHidden();
  await expect(link).toBeHidden();
});

test("delete-13: オフラインのラウンド詳細画面のとき、削除を確認すると、/roundsへ遷移する", async ({
  page,
}) => {
  // Given: 一覧を一度表示して端末に保存した後、詳細画面をオフラインで開いている
  const { name, roundId } = await createNamedRound("オフライン詳細削除");
  await openList(page, name);
  await openDetail(page, roundId);
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When
  await page.getByTestId("confirm-dialog-confirm").click();

  // Then
  await expect(page).toHaveURL(/\/rounds$/);
});

test("delete-14: オフラインでラウンドを削除したとき、オンラインへ復帰すると、再読み込みしてもラウンドが一覧に表示されない", async ({
  page,
}) => {
  // Given
  const { name, roundId } = await createNamedRound("復帰後に反映");
  const { row, link } = await openList(page, name);
  await waitForServiceWorkerControl(page);
  await goOffline(page.context());
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(link).toBeHidden();

  // When
  await comeBackOnline(page.context(), page);

  // Then
  await expectDeletedOnServer(roundId);
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
  await expect(link).toBeHidden();
});

test("delete-15: オフラインで開始したラウンドを、オフラインのまま削除したとき、オンラインへ復帰すると、再読み込みしてもラウンドが一覧に表示されない", async ({
  page,
}) => {
  // Given: オフラインで開始したラウンドの詳細を開いている
  await openNewRoundThenGoOffline(page);
  await startRoundOffline(page);
  const roundId = page.url().split("/").pop() ?? "";
  // 開始直後は設定ダイアログが開いているため、閉じる。
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When: 削除を確認し、オンラインへ復帰する
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page).toHaveURL(/\/rounds$/);
  await comeBackOnline(page.context(), page);

  // Then
  await expectDeletedOnServer(roundId);
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
  await expect(page.locator(`a[href="/rounds/${roundId}"]`)).toHaveCount(0);
});

test("delete-16: 削除の送信が完了していないとき、ラウンド一覧を再読み込みすると、ラウンドが一覧に表示されない", async ({
  page,
}) => {
  // Given: 削除の送信が完了しない
  const { name } = await createNamedRound("送信前に再読み込み");
  const { row, link } = await openList(page, name);
  const release = await holdDeleteRequest(page);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(link).toBeHidden();

  // When
  await page.reload();
  await waitForHydration(page);

  // Then
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
  await expect(link).toBeHidden();

  release();
});

test("delete-17: 削除が認可で拒否されるとき、削除を確認し、一覧を再読み込みすると、ラウンドが一覧に再び表示され、エラーメッセージは表示されない", async ({
  page,
}) => {
  // Given: 別のユーザーの権限で送られ、認可で拒否される
  const { name, roundId } = await createNamedRound("認可で拒否");
  const outsider = {
    email: `delete17-${randomUUID()}@example.com`,
    password: "password-e2e-outsider",
  };
  await createConfirmedUser(outsider);
  const outsiderDevice = await openOtherDevice(
    outsider.email,
    outsider.password,
  );
  let rejectedStatus = 0;
  await page.route(DISABLE_ROUND_RPC, async (route) => {
    rejectedStatus = await forwardAs(route, outsiderDevice.supabase);
  });
  const { row, link } = await openList(page, name);
  await row.getByTestId("round-menu-trigger").click();
  await page.getByTestId("round-delete").click();

  // When
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect.poll(() => rejectedStatus).toBe(403);
  // 拒否の処理(操作の列からの破棄)が終わってから読み込み直す。
  await expectNoPendingOps(page, roundId);
  await page.reload();
  await waitForHydration(page);

  // Then
  await expect(link).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveCount(0);
});

import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { blockOpLogStore } from "../helpers/op-log";
import { openOtherDevice, updateRound } from "../helpers/other-device";
import {
  openNewRoundThenGoOffline,
  startRoundOffline,
} from "../helpers/reference-data";
import { createRound } from "../helpers/rounds";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { holdNextRefresh } from "../helpers/session-overlap";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test("新規作成ボタンを押すと、ラウンド作成画面へ移動する", async ({ page }) => {
  await page.goto("/rounds");

  await page.getByTestId("new-round-fab").click();

  await expect(page).toHaveURL(/\/rounds\/new/);
  await expect(page.getByTestId("round-start-button")).toBeVisible();
});

test("ラウンドのカードを押すと、そのラウンドの詳細画面へ移動する", async ({
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
  await expect(page.getByTestId("round-summary")).toContainText("合計0");
});

// 入力中のラウンドの有無で表示が変わるため、以降のテストは使い捨てのユーザーで前提を作る。
test.describe("入力中の領域", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  type Credentials = { email: string; password: string };

  async function signInFreshUser(page: Page): Promise<Credentials> {
    const credentials = {
      email: `e2e-history-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
      password: "password-e2e-history",
    };
    await signUpAndSignIn(page, credentials);
    return credentials;
  }

  async function addRound(
    credentials: Credentials,
    name: string,
    roundDate: string,
    options: {
      completed?: boolean;
      shots?: { scoreStr: string; scoreInt: number }[];
    } = {},
  ): Promise<string> {
    const roundId = await createRound({
      ...credentials,
      name,
      roundDate,
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
      shots: options.shots?.map((shot) => ({
        distanceIndex: 0,
        endNumber: 1,
        ...shot,
      })),
    });
    if (options.completed) {
      const { supabase } = await openOtherDevice(
        credentials.email,
        credentials.password,
      );
      await updateRound(supabase, roundId, { status: "completed" });
    }
    return roundId;
  }

  const inProgressArea = (page: Page) => page.getByTestId("in-progress-rounds");
  const otherArea = (page: Page) => page.getByTestId("other-rounds");
  const offlineMessage = "ネットワークに接続されていません";

  // 入力中のラウンドと完了のラウンドを持つユーザーで、オンラインで一覧を開いて端末に保持させ、オフラインで一覧を開き直す。
  async function openOfflineList(page: Page) {
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page);
    const inProgressName = `入力中-${suffix}`;
    const completedName = `過去-${suffix}`;
    const inProgressId = await addRound(
      credentials,
      inProgressName,
      "2026-03-01",
      { shots: [{ scoreStr: "9", scoreInt: 9 }] },
    );
    await addRound(credentials, completedName, "2026-04-01", {
      completed: true,
    });
    await page.goto("/rounds");
    await expect(otherArea(page).getByText(completedName)).toBeVisible();
    await expect(inProgressArea(page).getByText(inProgressName)).toBeVisible();
    await waitForServiceWorkerControl(page);
    await goOffline(page.context());
    await page.goto("/rounds");
    await expect(page.getByText(offlineMessage)).toBeVisible();
    return {
      credentials,
      inProgressName,
      completedName,
      inProgressId,
    };
  }

  test("入力中のラウンドと、それより実施日の新しい完了のラウンドがあるとき、一覧を開くと、入力中のラウンドは「入力中」の見出しの下に、完了のラウンドは「過去履歴」の見出しの下に、名前・実施日・合計点で表示される", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page);
    await addRound(credentials, "入力中の古い", "2026-01-10", {
      shots: [{ scoreStr: "7", scoreInt: 7 }],
    });
    await addRound(credentials, "完了の新しい", "2026-05-01", {
      completed: true,
    });

    await page.goto("/rounds");

    const inProgressCard = inProgressArea(page).getByRole("link", {
      name: /入力中の古い/,
    });
    await expect(
      inProgressArea(page).getByRole("heading", { name: "入力中" }),
    ).toBeVisible();
    await expect(inProgressCard).toContainText("2026-01-10");
    await expect(inProgressCard).toContainText("7点");
    const completedCard = otherArea(page).getByRole("link", {
      name: /完了の新しい/,
    });
    await expect(
      otherArea(page).getByRole("heading", { name: "過去履歴" }),
    ).toBeVisible();
    await expect(completedCard).toContainText("2026-05-01");
    await expect(completedCard).toContainText("0点");
    await expect(otherArea(page).getByText("入力中の古い")).toHaveCount(0);
    await expect(inProgressArea(page).getByText("完了の新しい")).toHaveCount(0);
  });

  test("オンラインで一覧を表示した後にオフラインで開き直すと、入力中のラウンドが合計点つきで表示され、そのカードからラウンド詳細を開ける", async ({
    page,
  }) => {
    const { inProgressName, inProgressId } = await openOfflineList(page);
    const card = inProgressArea(page).getByRole("link", {
      name: new RegExp(inProgressName),
    });
    await expect(card).toContainText("2026-03-01");
    await expect(card).toContainText("9点");
    const others = otherArea(page);
    await expect(
      others.getByRole("heading", { name: "過去履歴" }),
    ).toBeVisible();
    await expect(others.getByText(offlineMessage)).toBeVisible();

    // 入力中のラウンドのカードを押し、オフラインのままラウンド詳細を開く。
    await card.click();
    await expect(page).toHaveURL(`/rounds/${inProgressId}`);
    await expect(page.getByTestId("round-summary")).toContainText("合計9");
  });

  test("オフラインで作成して点数を記録したラウンドは、一覧に戻ると、記録した点数を含む合計点で入力中のラウンドとして表示される", async ({
    page,
  }) => {
    // オンラインで的とプリセットを端末に保存し、オフラインでラウンドを始めて点数を記録する。
    await signInFreshUser(page);
    await openNewRoundThenGoOffline(page);
    await startRoundOffline(page, "WA 1440");
    const roundId = page.url().split("/").pop();
    await page.getByTestId("score-button-9").click();
    await expect(page.getByTestId("round-summary")).toContainText("合計9");

    // 一覧へ戻り、記録した点数を含む合計点を確かめる。
    await page.getByRole("link", { name: "一覧へ戻る" }).click();
    await expect(page).toHaveURL(/\/rounds$/);
    const card = inProgressArea(page).locator(`a[href="/rounds/${roundId}"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("9点");
  });

  test("オフラインの一覧でオンラインに戻ると、入力中でないラウンドも表示され、「ネットワークに接続されていません」が消え、同じラウンドが2件表示されない", async ({
    page,
    context,
  }) => {
    const { inProgressName, completedName } = await openOfflineList(page);

    // オンラインに戻り、入力中でないラウンドが加わるのを確かめる。
    await comeBackOnline(context, page);
    await expect(otherArea(page).getByText(completedName)).toBeVisible();
    await expect(page.getByText(offlineMessage)).toHaveCount(0);
    await expect(page.getByText(inProgressName)).toHaveCount(1);
    await expect(page.getByText(completedName)).toHaveCount(1);
  });

  test("オフラインで点数を記録した後、送信前にオンラインに戻って一覧を開くと、そのラウンドが1件だけ、記録した点数を含む合計点で表示される", async ({
    page,
    context,
  }) => {
    // 一覧から入力中のラウンドを開き、端末に保持させる。
    const credentials = await signInFreshUser(page);
    const name = `オフライン記録-${Date.now()}`;
    const roundId = await addRound(credentials, name, "2026-03-01");
    await page.goto("/rounds");
    await inProgressArea(page).getByText(name).click();
    await waitForHydration(page);
    await waitForServiceWorkerControl(page);
    // 制御の待ちで読み込み直した場合は、内容が出てからオフラインにする。
    await expect(page.getByTestId("score-button-9")).toBeVisible();

    // オフラインで点数を記録する。
    await goOffline(context);
    await page.getByTestId("score-button-9").click();
    await expect(page.getByTestId("round-summary")).toContainText("合計9");

    // 送信を止めたままオンラインに戻り、一覧へ戻って合計点を確かめる。
    await context.route("**/rest/v1/rpc/record_shots", (route) =>
      route.abort("failed"),
    );
    await comeBackOnline(context, page);
    await page.getByRole("link", { name: "一覧へ戻る" }).click();
    const card = page.locator(`a[href="/rounds/${roundId}"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("9点");
    await expect(inProgressArea(page).locator(card)).toHaveCount(1);
  });

  test("他の端末で入力中のラウンドを完了にした後に一覧を開くと、取得の完了後、そのラウンドが入力中の領域から外れて1件だけ表示される", async ({
    page,
  }) => {
    // 一覧を開き、入力中のラウンドを端末に保持させる。
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page);
    const name = `他端末-${suffix}`;
    const roundId = await addRound(credentials, name, "2026-03-01");
    const marker = `完了-${suffix}`;
    await addRound(credentials, marker, "2026-04-01", { completed: true });
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible();

    // 他の端末でそのラウンドを完了にしてから一覧を開き直し、取得の完了を待って確かめる。
    const { supabase } = await openOtherDevice(
      credentials.email,
      credentials.password,
    );
    await updateRound(supabase, roundId, { status: "completed" });
    await page.goto("/rounds");
    // 取得の完了は、入力中でないラウンドの表示で確かめる(入力中のラウンドが無くなると、見出しの節は出ない)。
    await expect(page.getByText(marker)).toBeVisible();
    // 入力中のラウンドが他に無いため、領域と見出しは無く、完了のラウンドとして見出しなしで出る。
    await expect(page.getByText(name)).toHaveCount(1);
    await expect(inProgressArea(page).getByText(name)).toHaveCount(0);
  });

  test("オフラインで入力を完了して一覧へ移ると、完了したラウンドは表示されず、オンラインに戻ると「過去履歴」の見出しの下に1件だけ表示される", async ({
    page,
    context,
  }) => {
    // 入力中のラウンドが2件ある一覧を開く。
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page);
    const completingName = `完了にする-${suffix}`;
    const remainingName = `残る-${suffix}`;
    await addRound(credentials, completingName, "2026-03-01");
    await addRound(credentials, remainingName, "2026-02-01");
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(remainingName)).toBeVisible();

    // 1件をラウンド詳細で開き、オフラインで入力を完了して一覧へ移る。
    await inProgressArea(page).getByText(completingName).click();
    await waitForHydration(page);
    await waitForServiceWorkerControl(page);
    await goOffline(page.context());
    await page.getByTestId("complete-round-button").click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(inProgressArea(page).getByText(remainingName)).toBeVisible();
    await expect(page.getByText(completingName)).toHaveCount(0);
    await expect(page.getByText(offlineMessage)).toBeVisible();

    // オンラインに戻り、完了したラウンドが「過去履歴」の見出しの下に1件だけ出るのを確かめる。
    await comeBackOnline(context, page);
    await expect(otherArea(page).getByText(completingName)).toBeVisible();
    await expect(page.getByText(completingName)).toHaveCount(1);
    await expect(inProgressArea(page).getByText(completingName)).toHaveCount(0);
  });

  test("端末に別のユーザーの入力中のラウンドがあるとき、別のユーザーでサインインしてオフラインで一覧を開くと、そのラウンドは表示されない", async ({
    page,
  }) => {
    // ユーザーAで一覧を開き、入力中のラウンドを端末に保持させる。
    const credentials = await signInFreshUser(page);
    const name = `別ユーザー-${Date.now()}`;
    await addRound(credentials, name, "2026-03-01");
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible();

    // サインアウトして、サインイン画面へ移る。
    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.getByRole("button", { name: "サインアウトする" }).click();
    await expect(page).toHaveURL(/\/signin/);

    // ユーザーBでサインインし、オフラインで一覧を開く。
    await signInFreshUser(page);
    await waitForServiceWorkerControl(page);
    await goOffline(page.context());
    await page.goto("/rounds");
    await expect(page.getByText(offlineMessage)).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
    await expect(inProgressArea(page)).toHaveCount(0);
  });

  // src/features/fetch-result/fetch-content.tsのFALLBACK_WAIT_MS。
  const fallbackWaitMs = 1_000;
  // 待ちの後の描画とブラウザ・CIの揺れの余裕。
  const renderMarginMs = 500;

  test("オンラインのまま一覧の取得が応答しないとき、通信の開始から1秒以内に入力中のラウンドが表示される", async ({
    page,
  }) => {
    // 一覧を開き、入力中のラウンドを端末に保持させる。
    const credentials = await signInFreshUser(page);
    const name = `通信できない-${Date.now()}`;
    await addRound(credentials, name, "2026-03-01");
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible();

    // 通信が応答しない状態で一覧を開き直し、入力中のラウンドが出るまでの時間を確かめる。
    // 待ちと表示の時刻をページ内で測る(Node側の時刻はポーリングの間隔を含むため)。
    await page.addInitScript((roundName) => {
      const w = window as unknown as {
        e2eFirstRequestAt?: number;
        e2eShownAt?: number;
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (/\/(rest|auth)\/v1\//.test(url)) {
          w.e2eFirstRequestAt ??= performance.now();
        }
        return originalFetch(input, init);
      };
      new MutationObserver(() => {
        const el = document.querySelector('[data-testid="in-progress-rounds"]');
        if (el?.textContent?.includes(roundName))
          w.e2eShownAt ??= performance.now();
      }).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }, name);
    // Service Workerが制御する文書の通信も止めるため、contextで止める。
    await page.context().route(/\/(rest|auth)\/v1\//, () => {});
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible({
      timeout: 10_000,
    });
    const { firstRequestAt, shownAt } = await page.evaluate(() => {
      const w = window as unknown as {
        e2eFirstRequestAt?: number;
        e2eShownAt?: number;
      };
      return { firstRequestAt: w.e2eFirstRequestAt, shownAt: w.e2eShownAt };
    });
    if (firstRequestAt === undefined) throw new Error("通信を始めていない");
    if (shownAt === undefined) throw new Error("表示されていない");
    expect(shownAt - firstRequestAt).toBeLessThan(
      fallbackWaitMs + renderMarginMs,
    );
  });

  test("オンラインのまま一覧の取得に失敗したとき、入力中のラウンドが表示され、「過去履歴」の見出しの下に「読み込めませんでした。」と再試行ボタンが表示される", async ({
    page,
    context,
  }) => {
    // 一覧を開き、入力中のラウンドを端末に保持させる。
    const credentials = await signInFreshUser(page);
    const name = `失敗-${Date.now()}`;
    await addRound(credentials, name, "2026-03-01");
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible();

    // 一覧の取得を失敗させて開き直し、入力中のラウンドとエラーを確かめる。
    await context.route("**/rest/v1/rounds?*", (route) =>
      route.abort("failed"),
    );
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible();
    const others = otherArea(page);
    await expect(
      others.getByRole("heading", { name: "過去履歴" }),
    ).toBeVisible();
    await expect(others.getByText("読み込めませんでした。")).toBeVisible();
    await expect(others.getByRole("button", { name: "再試行" })).toBeVisible();
  });

  test("一覧を開くときにセッションの更新が別の書き手の更新と重なっても、「サインインが必要です。」は表示されず、ラウンドが表示される", async ({
    page,
  }) => {
    // セッションの更新を止めたまま、リンクで一覧を開く。
    // セッションの更新はリフレッシュトークンを入れ替えるため、共有のユーザーでなく使い捨てのユーザーで行う。
    const credentials = await signInFreshUser(page);
    const name = `重なり-${Date.now()}`;
    await addRound(credentials, name, "2026-03-01", { completed: true });
    await page.goto("/rounds/new");
    await waitForHydration(page);
    const refresh = await holdNextRefresh(page);
    // ページを読み込み直すと、更新が初期化の中で済み、取得の確認と重ならないため、リンクで開く。
    await page.getByRole("link", { name: "一覧へ戻る" }).click();
    await refresh.requested;
    await expect(
      page.getByRole("status").filter({ hasText: "読み込み中" }),
    ).toBeVisible();

    // 止めた更新を別の書き手の更新と重ねて通し、ラウンドが表示されるのを確かめる。
    refresh.release();
    await refresh.passed;
    await expect(
      page.getByRole("link", { name: new RegExp(name) }),
    ).toBeVisible();
    await expect(page.getByText("サインインが必要です。")).toHaveCount(0);
  });

  test("他のタブが端末の保存の読み書きを続けているとき、一覧を開くと、10秒後に「読み込めませんでした。」と再試行ボタンが表示される", async ({
    page,
  }) => {
    // 他のタブが端末の保存を使い続ける状態で一覧を開き、読み込み中を確かめる。
    await signInFreshUser(page);
    await page.goto("/rounds");
    await waitForHydration(page);
    const release = await blockOpLogStore(page);
    await page.clock.install();
    await page.goto("/rounds");
    await expect(
      page.getByRole("status").filter({ hasText: "読み込み中" }),
    ).toBeVisible();

    // 10秒進め、エラーと再試行ボタンを確かめる。
    await page.clock.runFor(10_000);
    await expect(
      page.getByRole("alert").filter({ hasText: "読み込めませんでした。" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
    await release();
  });
});

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
import {
  disableRound,
  getDistanceIds,
  openOtherDevice,
  recordShot,
  updateRound,
} from "../helpers/other-device";
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

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test("history-01: 認証済みでラウンドが1件以上あるとき、/roundsを開くと、各ラウンドの名前・実施日・合計点が表示される", async ({
  page,
}) => {
  // Given
  const name = `一覧表示テスト-${Date.now()}`;
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
    shots: [
      {
        distanceIndex: 0,
        endNumber: 1,
        scoreStr: "7",
        scoreInt: 7,
      },
    ],
  });

  // When
  await page.goto("/rounds");

  // Then
  const roundLink = page.getByRole("link", { name: new RegExp(name) });
  await expect(roundLink).toBeVisible();
  await expect(roundLink).toContainText("2026-08-24");
  await expect(roundLink).toContainText("7点");
});

test("history-02: 新規作成ボタンをクリックすると、/rounds/newへ遷移する", async ({
  page,
}) => {
  // Given
  await page.goto("/rounds");

  // When
  await page.getByTestId("new-round-fab").click();

  // Then
  await expect(page).toHaveURL(/\/rounds\/new/);
});

test("history-03: ラウンドが1件以上あるとき、ラウンドカードをクリックすると、/rounds/[id]へ遷移する", async ({
  page,
}) => {
  // Given
  const name = `ラウンドカードテスト-${Date.now()}`;
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 1 }],
  });
  await page.goto("/rounds");

  // When
  await page.getByRole("link", { name: new RegExp(name) }).click();

  // Then
  await expect(page).toHaveURL(`/rounds/${roundId}`);
});

const ROUNDS_LIST_REST = "**/rest/v1/rounds?*";

test("history-06: ラウンド一覧で通信できないとき、/roundsを開くと、見出しと新規作成ボタンと「読み込めませんでした。」と再試行ボタンが表示される", async ({
  page,
}) => {
  // Given
  await page.route(ROUNDS_LIST_REST, (route) => route.abort("failed"));

  // When
  await page.goto("/rounds");

  // Then
  await expect(
    page.getByRole("heading", { name: "ラウンド一覧" }),
  ).toBeVisible();
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
  await expect(page.getByText("読み込めませんでした。")).toBeVisible();
  await expect(page.getByRole("button", { name: "再試行" })).toBeVisible();
});

test("history-07: ラウンド一覧で取得がエラーになるとき、/roundsを開くと、エラーメッセージが表示される", async ({
  page,
}) => {
  // Given
  // エラー表示の代表として、サーバーエラー(500)で確かめる。他のエラー種別は単体テストで確かめる。
  await page.route(ROUNDS_LIST_REST, (route) =>
    route.fulfill({ status: 500, body: "temporary error" }),
  );

  // When
  await page.goto("/rounds");

  // Then
  // Next.jsのroute announcerも role="alert" を持つため、メッセージで絞る。
  await expect(
    page.getByRole("alert").filter({ hasText: "読み込めませんでした。" }),
  ).toBeVisible();
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
      distances: [{ distance: 18, totalEnds: 1, arrowsPerEnd: 3 }],
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
  const OFFLINE_MESSAGE = "ネットワークに接続されていません";

  // 領域の中のカードの名前を、並びの順に返す。カードの文字は名前・実施日・合計点が続く。
  async function names(area: ReturnType<typeof inProgressArea>) {
    return (await area.getByRole("link").allTextContents()).map(
      (text) => text.match(/^(進行|完了)-(新しい|古い)/)?.[0],
    );
  }

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
    await expect(page.getByText(OFFLINE_MESSAGE)).toBeVisible();
    return {
      credentials,
      inProgressName,
      completedName,
      inProgressId,
    };
  }

  test("history-05: ラウンド一覧で認証済み、実施日の異なる入力中のラウンドが複数と、実施日の異なる完了のラウンドが複数ある、/roundsを開くと、入力中のラウンドが先頭にまとめて表示され、入力中のラウンドとそれ以外のラウンドがそれぞれ実施日の新しい順に表示される", async ({
    page,
  }) => {
    // Given: 実施日と作成順を逆にして、並べ替えなしでは通らないようにする
    const credentials = await signInFreshUser(page);
    await addRound(credentials, "進行-古い", "2026-01-10");
    await addRound(credentials, "進行-新しい", "2026-03-20");
    await addRound(credentials, "完了-古い", "2026-02-01", { completed: true });
    await addRound(credentials, "完了-新しい", "2026-04-01", {
      completed: true,
    });

    // When
    await page.goto("/rounds");

    // Then
    await expect(inProgressArea(page).getByRole("link")).toHaveCount(2);
    expect(await names(inProgressArea(page))).toEqual([
      "進行-新しい",
      "進行-古い",
    ]);
    expect(await names(otherArea(page))).toEqual(["完了-新しい", "完了-古い"]);
    const main = await page.getByRole("main").innerText();
    expect(main.indexOf("進行-古い")).toBeLessThan(main.indexOf("完了-新しい"));
  });

  test("history-22: ラウンド一覧で、入力中のラウンドと、それより実施日の新しい完了のラウンドがある、/roundsを開くと、入力中の見出しの領域に入力中のラウンドが先に表示され、完了のラウンドはその後の「過去履歴」の見出しの下に表示される、入力中のラウンドは「過去履歴」の下に表示されない", async ({
    page,
  }) => {
    // Given
    const credentials = await signInFreshUser(page);
    await addRound(credentials, "入力中の古い", "2026-01-10");
    await addRound(credentials, "完了の新しい", "2026-05-01", {
      completed: true,
    });

    // When
    await page.goto("/rounds");

    // Then
    await expect(
      inProgressArea(page).getByRole("heading", { name: "入力中" }),
    ).toBeVisible();
    await expect(inProgressArea(page).getByText("入力中の古い")).toBeVisible();
    await expect(
      otherArea(page).getByRole("heading", { name: "過去履歴" }),
    ).toBeVisible();
    await expect(otherArea(page).getByText("完了の新しい")).toBeVisible();
    await expect(otherArea(page).getByText("入力中の古い")).toHaveCount(0);
    await expect(inProgressArea(page).getByText("完了の新しい")).toHaveCount(0);
  });

  test("history-23: ラウンド一覧で、入力中のラウンドが無く、完了のラウンドがある、/roundsを開くと、入力中の見出しと領域、「過去履歴」の見出しが表示されない、完了のラウンドが今と同じ形で表示される", async ({
    page,
  }) => {
    // Given
    const credentials = await signInFreshUser(page);
    await addRound(credentials, "完了のみ", "2026-05-01", { completed: true });

    // When
    await page.goto("/rounds");

    // Then
    await expect(page.getByRole("link", { name: /完了のみ/ })).toBeVisible();
    await expect(inProgressArea(page)).toHaveCount(0);
    await expect(otherArea(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "入力中" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "過去履歴" })).toHaveCount(
      0,
    );
  });

  test("history-08: ラウンド一覧で、オンラインで取得した入力中のラウンドがあり、オフラインで再起動した、/roundsを開くと、入力中のラウンドの名前・実施日・合計点が表示される、「過去履歴」の見出しの下に「ネットワークに接続されていません」が表示される", async ({
    page,
  }) => {
    // Given / When: オンラインで取得した後、オフラインで/roundsを開き直している
    const { inProgressName } = await openOfflineList(page);

    // Then
    const card = inProgressArea(page).getByRole("link", {
      name: new RegExp(inProgressName),
    });
    await expect(card).toContainText("2026-03-01");
    await expect(card).toContainText("9点");
    const others = otherArea(page);
    await expect(
      others.getByRole("heading", { name: "過去履歴" }),
    ).toBeVisible();
    await expect(others.getByText(OFFLINE_MESSAGE)).toBeVisible();
  });

  test("history-09: オフラインのラウンド一覧に入力中のラウンドが表示されている、入力中のラウンドのカードをクリックすると、ラウンド詳細が表示される", async ({
    page,
  }) => {
    // Given
    const { inProgressName, inProgressId } = await openOfflineList(page);

    // When
    await inProgressArea(page)
      .getByRole("link", { name: new RegExp(inProgressName) })
      .click();

    // Then
    await expect(page).toHaveURL(`/rounds/${inProgressId}`);
    await expect(page.getByTestId("round-summary")).toContainText("合計9");
  });

  test("history-10: オフラインで作成し点数を記録した、送信前のラウンドがある、/roundsを開くと、そのラウンドが、記録した点数を含む合計点で表示される", async ({
    page,
  }) => {
    // Given: オンラインで的とプリセットを端末に保存させ、オフラインで作成して点数を記録する
    await signInFreshUser(page);
    await openNewRoundThenGoOffline(page);
    await startRoundOffline(page, "WA 1440");
    const roundId = page.url().split("/").pop();
    await page.getByTestId("score-button-9").click();
    await expect(page.getByTestId("round-summary")).toContainText("合計9");

    // When: 一覧へ戻る
    await page.getByRole("link", { name: "一覧へ戻る" }).click();

    // Then
    await expect(page).toHaveURL(/\/rounds$/);
    const card = inProgressArea(page).locator(`a[href="/rounds/${roundId}"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("9点");
  });

  test("history-11: オフラインのラウンド一覧に入力中のラウンドが表示されている、オンラインへ復帰すると、入力中でないラウンドも表示される、「ネットワークに接続されていません」が表示されなくなる、同じラウンドが2件表示されない", async ({
    page,
    context,
  }) => {
    // Given
    const { inProgressName, completedName } = await openOfflineList(page);

    // When
    await comeBackOnline(context, page);

    // Then
    await expect(otherArea(page).getByText(completedName)).toBeVisible();
    await expect(page.getByText(OFFLINE_MESSAGE)).toHaveCount(0);
    await expect(page.getByText(inProgressName)).toHaveCount(1);
    await expect(page.getByText(completedName)).toHaveCount(1);
  });

  test("history-12: オフラインのラウンド一覧に入力中のラウンドが表示されている、入力中のラウンドをメニューから削除すると、そのラウンドが一覧から消える", async ({
    page,
  }) => {
    // Given
    const { inProgressName } = await openOfflineList(page);

    // When
    await inProgressArea(page).getByTestId("round-menu-trigger").click();
    await page.getByTestId("round-delete").click();
    await page.getByTestId("confirm-dialog-confirm").click();

    // Then
    await expect(page.getByText(inProgressName)).toHaveCount(0);
    await expect(inProgressArea(page)).toHaveCount(0);
  });

  test("history-13: オフラインで点数を記録した入力中のラウンドがあり、オンラインへ復帰した直後で送信前、/roundsを開くと、そのラウンドが1件だけ表示される、合計点がオフラインで記録した点数を含む", async ({
    page,
    context,
  }) => {
    // Given: 入力中のラウンドを端末に保持し、オフラインで点数を記録し、送信が通らないままオンラインへ復帰する
    const credentials = await signInFreshUser(page);
    const name = `オフライン記録-${Date.now()}`;
    const roundId = await addRound(credentials, name, "2026-03-01");
    await page.goto("/rounds");
    await inProgressArea(page).getByText(name).click();
    await waitForHydration(page);
    await waitForServiceWorkerControl(page);
    await goOffline(context);
    await page.getByTestId("score-button-9").click();
    await expect(page.getByTestId("round-summary")).toContainText("合計9");
    await context.route("**/rest/v1/rpc/record_shots", (route) =>
      route.abort("failed"),
    );
    await comeBackOnline(context, page);

    // When: 一覧へ戻る
    await page.getByRole("link", { name: "一覧へ戻る" }).click();

    // Then
    const card = page.locator(`a[href="/rounds/${roundId}"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("9点");
    await expect(inProgressArea(page).locator(card)).toHaveCount(1);
  });

  // 端末が入力中のラウンドを保持した後、他端末が変更し、再び/roundsを開く。
  async function openAfterOtherDevice(
    page: Page,
    change: (input: {
      supabase: Awaited<ReturnType<typeof openOtherDevice>>["supabase"];
      userId: string;
      roundId: string;
    }) => Promise<void>,
  ) {
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page);
    const name = `他端末-${suffix}`;
    const roundId = await addRound(credentials, name, "2026-03-01", {
      shots: [{ scoreStr: "5", scoreInt: 5 }],
    });
    const marker = `完了-${suffix}`;
    await addRound(credentials, marker, "2026-04-01", { completed: true });
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible();
    const { supabase, userId } = await openOtherDevice(
      credentials.email,
      credentials.password,
    );
    await change({ supabase, userId, roundId });
    await page.goto("/rounds");
    // 取得の完了は、入力中でないラウンドの表示で確かめる(入力中のラウンドが無くなると、見出しの節は出ない)。
    await expect(page.getByText(marker)).toBeVisible();
    return { name };
  }

  test("history-14: 他端末が入力中のラウンドへ点数を記録した後、オンライン、/roundsを開くと、他端末の点数を含む合計点で表示される", async ({
    page,
  }) => {
    // Given / When
    const { name } = await openAfterOtherDevice(
      page,
      async ({ supabase, roundId }) => {
        const [distanceId] = await getDistanceIds(supabase, roundId);
        await recordShot(supabase, {
          distanceId,
          endNumber: 1,
          scoreStr: "7",
          scoreInt: 7,
        });
      },
    );

    // Then
    await expect(
      inProgressArea(page).getByRole("link", { name: new RegExp(name) }),
    ).toContainText("12点");
  });

  test("history-15: 他端末が入力中のラウンドを削除した後、オンライン、/roundsを開くと、取得の完了後、そのラウンドが表示されない", async ({
    page,
  }) => {
    // Given / When
    const { name } = await openAfterOtherDevice(
      page,
      async ({ supabase, roundId }) => {
        await disableRound(supabase, roundId);
      },
    );

    // Then
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("history-24: 他端末が入力中のラウンドを完了にした後、オンライン、/roundsを開くと、取得の完了後、そのラウンドは入力中の領域に表示されず、それ以外のラウンドの並びに1件だけ表示される", async ({
    page,
  }) => {
    // Given / When
    const { name } = await openAfterOtherDevice(
      page,
      async ({ supabase, roundId }) => {
        await updateRound(supabase, roundId, { status: "completed" });
      },
    );

    // Then: 入力中のラウンドが他に無いため、領域も見出しも無く、完了のラウンドとして1件だけ表示される
    await expect(page.getByText(name)).toHaveCount(1);
    await expect(inProgressArea(page).getByText(name)).toHaveCount(0);
  });

  // オフラインの詳細から、入力中のラウンドの1件を完了にして、一覧へ移る。
  async function completeOneOffline(page: Page) {
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page);
    const completingName = `完了にする-${suffix}`;
    const remainingName = `残る-${suffix}`;
    await addRound(credentials, completingName, "2026-03-01");
    await addRound(credentials, remainingName, "2026-02-01");
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(remainingName)).toBeVisible();
    await inProgressArea(page).getByText(completingName).click();
    await waitForHydration(page);
    await waitForServiceWorkerControl(page);
    await goOffline(page.context());
    await page.getByTestId("complete-round-button").click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page).toHaveURL(/\/rounds$/);
    return { completingName, remainingName };
  }

  test("history-16: オフラインのラウンド詳細画面で、入力中のラウンドが別にもう1件ある、入力を完了するボタンをクリックし、確認すると、ラウンド一覧へ移る、完了したラウンドは表示されず、もう1件の入力中のラウンドは表示される、「ネットワークに接続されていません」が表示される", async ({
    page,
  }) => {
    // Given / When
    const { completingName, remainingName } = await completeOneOffline(page);

    // Then
    await expect(inProgressArea(page).getByText(remainingName)).toBeVisible();
    await expect(page.getByText(completingName)).toHaveCount(0);
    await expect(page.getByText(OFFLINE_MESSAGE)).toBeVisible();
  });

  test("history-17: オフラインで入力を完了した後のラウンド一覧、オンラインへ復帰すると、完了したラウンドが、入力中の領域でなくそれ以外のラウンドの並びに1件だけ表示される", async ({
    page,
    context,
  }) => {
    // Given
    const { completingName } = await completeOneOffline(page);

    // When
    await comeBackOnline(context, page);

    // Then
    await expect(otherArea(page).getByText(completingName)).toBeVisible();
    await expect(page.getByText(completingName)).toHaveCount(1);
    await expect(inProgressArea(page).getByText(completingName)).toHaveCount(0);
  });

  test("history-18: 端末に別ユーザーの入力中のラウンドがあり、別のユーザーでサインインしてオフライン、/roundsを開くと、別ユーザーのラウンドは表示されない", async ({
    page,
  }) => {
    // Given: ユーザーAの入力中のラウンドを端末に保持し、サインアウトして別のユーザーBでサインインする
    const credentials = await signInFreshUser(page);
    const name = `別ユーザー-${Date.now()}`;
    await addRound(credentials, name, "2026-03-01");
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible();
    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.getByRole("button", { name: "サインアウトする" }).click();
    await expect(page).toHaveURL(/\/signin/);
    await signInFreshUser(page);
    await waitForServiceWorkerControl(page);
    await goOffline(page.context());

    // When
    await page.goto("/rounds");

    // Then
    await expect(page.getByText(OFFLINE_MESSAGE)).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
    await expect(inProgressArea(page)).toHaveCount(0);
  });

  // src/features/fetch-result/fetch-content.tsのFALLBACK_WAIT_MS。
  const FALLBACK_WAIT_MS = 1_000;
  // 待ちの後の描画とブラウザ・CIの揺れの余裕。
  const RENDER_MARGIN_MS = 500;

  test("history-19: navigator.onLineがtrueのまま一覧の取得が応答せず、入力中のラウンドがある、/roundsを開くと、通信の開始から1秒以内に、入力中のラウンドが表示される", async ({
    page,
  }) => {
    // Given: 端末が入力中のラウンドを保持し、その後、通信が応答しなくなる
    const credentials = await signInFreshUser(page);
    const name = `通信できない-${Date.now()}`;
    await addRound(credentials, name, "2026-03-01");
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible();
    // 待ちと表示の時刻をページ内で測る(Node側の時刻はポーリングの間隔を含むため)。
    await page.addInitScript((roundName) => {
      const w = window as unknown as {
        __firstRequestAt?: number;
        __shownAt?: number;
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (/\/(rest|auth)\/v1\//.test(url)) {
          w.__firstRequestAt ??= performance.now();
        }
        return originalFetch(input, init);
      };
      new MutationObserver(() => {
        const el = document.querySelector('[data-testid="in-progress-rounds"]');
        if (el?.textContent?.includes(roundName))
          w.__shownAt ??= performance.now();
      }).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }, name);
    // Service Workerが制御する文書の通信も止めるため、contextで止める。
    await page.context().route(/\/(rest|auth)\/v1\//, () => {});

    // When
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible({
      timeout: 10_000,
    });

    // Then: 通信の開始から、待ちの上限(FALLBACK_WAIT_MS)と描画の余裕のうちに表示されている
    const { firstRequestAt, shownAt } = await page.evaluate(() => {
      const w = window as unknown as {
        __firstRequestAt?: number;
        __shownAt?: number;
      };
      return { firstRequestAt: w.__firstRequestAt, shownAt: w.__shownAt };
    });
    if (firstRequestAt === undefined) throw new Error("通信を始めていない");
    if (shownAt === undefined) throw new Error("表示されていない");
    expect(shownAt - firstRequestAt).toBeLessThan(
      FALLBACK_WAIT_MS + RENDER_MARGIN_MS,
    );
  });

  test("history-20: 一覧の取得が応答しない間に、入力中のラウンドが表示されている、取得が完了すると、各ラウンドが1件ずつ表示される", async ({
    page,
    context,
  }) => {
    // Given: 端末が入力中のラウンドを保持し、取得を保留して、入力中のラウンドが表示されている
    const suffix = Date.now();
    const credentials = await signInFreshUser(page);
    const inProgressName = `保留中-${suffix}`;
    const completedName = `保留後-${suffix}`;
    await addRound(credentials, inProgressName, "2026-03-01");
    await addRound(credentials, completedName, "2026-04-01", {
      completed: true,
    });
    await page.goto("/rounds");
    await expect(otherArea(page).getByText(completedName)).toBeVisible();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route("**/rest/v1/rounds?*", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(inProgressName)).toBeVisible();

    // When
    release();

    // Then
    await expect(otherArea(page).getByText(completedName)).toBeVisible();
    await expect(page.getByText(inProgressName)).toHaveCount(1);
    await expect(page.getByText(completedName)).toHaveCount(1);
  });

  test("history-21: 通信に失敗し(navigator.onLineがtrue)、入力中のラウンドがある、/roundsを開くと、入力中のラウンドが表示される、「過去履歴」の見出しの下に「読み込めませんでした。」と再試行ボタンが表示される", async ({
    page,
    context,
  }) => {
    // Given
    const credentials = await signInFreshUser(page);
    const name = `失敗-${Date.now()}`;
    await addRound(credentials, name, "2026-03-01");
    await page.goto("/rounds");
    await expect(inProgressArea(page).getByText(name)).toBeVisible();
    await context.route("**/rest/v1/rounds?*", (route) =>
      route.abort("failed"),
    );

    // When
    await page.goto("/rounds");

    // Then
    await expect(inProgressArea(page).getByText(name)).toBeVisible();
    const others = otherArea(page);
    await expect(
      others.getByRole("heading", { name: "過去履歴" }),
    ).toBeVisible();
    await expect(others.getByText("読み込めませんでした。")).toBeVisible();
    await expect(others.getByRole("button", { name: "再試行" })).toBeVisible();
  });
});

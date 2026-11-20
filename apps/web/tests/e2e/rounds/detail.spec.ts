import type { Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { roundPath } from "@/routes";
import { expect, test } from "../fixtures";
import {
  getSharedEmail,
  injectStoredSession,
  SHARED_AUTH_STATE_PATH,
  SHARED_PASSWORD,
  waitForHydration,
} from "../helpers/auth";
import { disableRound, openOtherDevice } from "../helpers/other-device";
import {
  blockTargetFacesOnDevice,
  expectRoundBasesFetched,
  openNewRoundThenGoOffline,
  TARGET_FACES_REST,
} from "../helpers/reference-data";
import { roundName } from "../helpers/round-name";
import { createRound } from "../helpers/rounds";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

const roundsText = translatorFor("rounds");

test.use({ storageState: SHARED_AUTH_STATE_PATH });

type RoundInput = Omit<Parameters<typeof createRound>[0], "email" | "password">;

// 既定は、1距離・12エンド・3射のラウンド。
async function openRound(page: Page, overrides: Partial<RoundInput> = {}) {
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "詳細テスト",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    ...overrides,
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  return roundId;
}

function shot(distanceIndex: number, endNumber: number, score: string) {
  return {
    distanceIndex,
    endNumber,
    scoreStr: score,
    scoreInt: score === "X" ? 10 : Number(score),
  };
}

const TWO_DISTANCES = [
  { distance: 18, totalEnds: 12, arrowsPerEnd: 3 },
  { distance: 30, totalEnds: 12, arrowsPerEnd: 3 },
];

test("記録済みの得点があるラウンドを開くと、スコアカードが表示され、ラウンド結果に合計が、距離結果に距離ごとの小計と、Xのある的ではX数と最高点数が表示される", async ({
  page,
}) => {
  await openRound(page, {
    distances: TWO_DISTANCES,
    shots: [shot(0, 1, "X"), shot(0, 1, "8"), shot(1, 1, "5")],
  });

  await expect(page.getByTestId("round-config-summary")).toBeVisible();
  await expect(page.getByTestId("end-row-1-1")).toBeVisible();
  await expect(page.getByTestId("round-summary")).toContainText(
    roundsText("roundTotal", { total: "23" }),
  );
  await expect(page.getByTestId("distance-summary-1")).toContainText(
    roundsText("distanceSubtotal", { total: "18" }),
  );
  await expect(page.getByTestId("distance-summary-2")).toContainText(
    roundsText("distanceSubtotal", { total: "5" }),
  );
  await expect(page.getByTestId("distance-top-scores-1")).toHaveText(
    "10: 1 / X: 1",
  );
});

test("「戻る」リンクを押すと、ホームへ移動する", async ({ page }) => {
  await openRound(page);

  await page.getByRole("link", { name: roundsText("back") }).click();

  await expect(page).toHaveURL(/\/rounds$/);
  await expect(page.getByTestId("new-round-fab")).toBeVisible();
});

test("履歴を2つ戻って詳細から別の詳細へ移ると、前のラウンドでなく、URLのラウンドが表示される", async ({
  page,
}) => {
  const suffix = Date.now();
  const nameA = `履歴の詳細A-${suffix}`;
  const nameB = `履歴の詳細B-${suffix}`;
  // 詳細Bは、端末が同期で取り込めるよう、詳細Aを開く前に作る。
  await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: nameB,
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await openRound(page, { name: nameA });

  // 詳細Aからホームへ戻り、ホームのカードから詳細Bを開く。
  await page.getByRole("link", { name: roundsText("back") }).click();
  await page.getByRole("link", { name: new RegExp(nameB) }).click();
  await expect(roundName(page)).toContainText(nameB);

  // 履歴を2つ戻り、詳細Aへ移る。
  await page.evaluate(() => window.history.go(-2));

  await expect(roundName(page)).toContainText(nameA);
});

const MISSING_ROUND_PATH = roundPath("00000000-0000-0000-0000-000000000000");
const ROUND_DETAIL_REST = "**/rest/v1/rounds?*";

test("存在しないラウンドを開くと、枠内に「ラウンドが見つかりません。」と「戻る」リンクが表示される", async ({
  page,
}) => {
  await page.goto(MISSING_ROUND_PATH);

  await expect(page.getByText(roundsText("detailNotFound"))).toBeVisible();
  await expect(
    page.getByRole("link", { name: roundsText("back") }),
  ).toBeVisible();
});

test("端末にオフラインで開ける内容がないラウンドを開いて通信できないとき、「戻る」リンクと「読み込めませんでした。」と再試行ボタンが表示される", async ({
  page,
}) => {
  // 裏の取得の再試行の間にService Workerが制御を始めるため、contextで止める。
  await page
    .context()
    .route(ROUND_DETAIL_REST, (route) => route.abort("failed"));

  await page.goto(MISSING_ROUND_PATH);

  await expect(
    page.getByRole("link", { name: roundsText("back") }),
  ).toBeVisible();
  // 取得の再試行が尽きるまで約7秒かかり、10秒の打ち切りより前に失敗が表示される。
  await expect(page.getByText(roundsText("fetchFailure.failed"))).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByRole("button", { name: roundsText("fetchRetry") }),
  ).toBeVisible();
});

// オフラインの/rounds/newで開始し、的の一覧の保存分が無い、作成が未確定のラウンド詳細を開く。
// 内容を出さない間は水和の属性が付かないため、startRoundOfflineを使わない。
async function startRoundOfflineWithoutTargetFaces(page: Page) {
  await blockTargetFacesOnDevice(page);
  // 的の一覧の取得を止めているため、一括の取得の完了は待たない。
  await openNewRoundThenGoOffline(page, { waitForTargetFaces: false });
  await page.getByTestId("round-start-button").click();
  await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]+$/);
}

test("的の一覧を端末に保存せずにオフラインで開始したラウンドは、内容が表示されず「ネットワークに接続されていません」が表示され、オンラインに戻ると内容が表示される", async ({
  page,
}) => {
  await startRoundOfflineWithoutTargetFaces(page);
  await expect(page.getByText(roundsText("fetchOffline"))).toBeVisible();
  await expect(page.getByTestId("round-summary")).toHaveCount(0);

  // 的の一覧の取得を戻してオンラインに戻り、ラウンドの内容が表示されるのを確かめる。
  await page.context().unroute(TARGET_FACES_REST);
  await comeBackOnline(page.context(), page);
  await expect(page.getByTestId("round-summary")).toBeVisible();
  await expect(page.getByText(roundsText("fetchOffline"))).toHaveCount(0);
});

test("他の端末で記録した入力中のラウンドは、オンラインで取得を済ませた後なら、一度も開かずにオフラインで再起動して開いても、記録と合計と仮の矢とテンキーが表示される", async ({
  profile,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing application URL in e2e test.");
  // 他の端末で記録した入力中のラウンドを用意し、この端末でサインインして端末への取得を済ませる。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "他端末で記録",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    shots: [shot(0, 1, "X"), shot(0, 1, "8")],
  });
  const first = await profile.open();
  // 他の端末の記録の準備で確認済みのセッションを渡す(画面のサインインは同じ宛先の送信間隔を待つため)。
  await injectStoredSession(first.context, baseURL, getSharedEmail());
  await first.page.goto("/rounds");
  await waitForHydration(first.page);
  await waitForServiceWorkerControl(first.page);
  await expectRoundBasesFetched(first.page, { roundId });

  // ブラウザを開き直してオフラインにし、一度も開いていないラウンドを開く。
  await profile.close();
  const { context, page } = await profile.open();
  await goOffline(context);
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expect(page.getByTestId("round-summary")).toContainText(
    roundsText("roundTotal", { total: "18" }),
  );
  await expect(page.getByTestId("distance-summary-1")).toContainText("18m");
  await expect(
    page.getByTestId("end-row-1-1").locator("[data-shot-id]"),
  ).toHaveText(["X", "8"]);
  await expect(
    page.getByTestId("end-row-1-1").getByTestId("provisional-shot"),
  ).toBeVisible();
  await expect(
    page.getByTestId("distance-summary-1").locator('[role="img"]').first(),
  ).toBeVisible();
  await expect(page.getByTestId("score-button-9")).toBeVisible();
});

test("端末の内容で表示しているラウンドが、他の端末で削除されていたと分かると、その画面のまま見つからない表示になる", async ({
  page,
}) => {
  // ホームを開き、入力中のラウンドと的の一覧を端末に保持させる。
  const roundId = await createRound({
    email: getSharedEmail(),
    password: SHARED_PASSWORD,
    name: "他の端末で削除",
    roundDate: "2026-08-24",
    distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
  });
  await page.goto("/rounds");
  await expectRoundBasesFetched(page, { roundId });

  // 他の端末がラウンドを削除した後に、取得が保留された状態で詳細を開き、端末の内容でラウンドが表示されることを確かめる。
  const { supabase } = await openOtherDevice(getSharedEmail(), SHARED_PASSWORD);
  await disableRound(supabase, roundId);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 取得を保留したまま端末の内容で表示されることを確かめるため、ラウンドの取得を保留する。
  // Service Workerが制御する文書の通信も止めるため、contextで止める。
  await page.context().route("**/rest/v1/rounds?*", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/rounds/${roundId}`);
  await expect(roundName(page)).toContainText("他の端末で削除");

  // 保留を解き、取得でラウンドが無いと分かると、詳細のURLのまま見つからない表示と戻るリンクが出ることを確かめる。
  release();
  await expect(page.getByText(roundsText("detailNotFound"))).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}$`));
  await expect(
    page.getByRole("link", { name: roundsText("back") }),
  ).toBeVisible();
});

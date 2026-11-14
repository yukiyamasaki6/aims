import type { Locator, Page } from "@playwright/test";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  SHARED_AUTH_STATE_PATH,
  signOutFromSettings,
  waitForHydration,
} from "../helpers/auth";
import {
  getRoundRow,
  openOtherDevice,
  updateRound,
} from "../helpers/other-device";
import {
  addRound,
  type Credentials,
  signInFreshUser,
} from "../helpers/round-fixtures";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";

const navigationText = translatorFor("navigation");
const roundsText = translatorFor("rounds");

// 公式の的: 10点的(アウトドア・122cm)と10点的(アウトドア・80cm)。
const LARGE_FACE_ID = "a1000000-0000-0000-0000-000000000001";
const SMALL_FACE_ID = "a1000000-0000-0000-0000-000000000002";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

// 選択欄を開いて、名前の項目を選ぶ。
async function chooseOption(page: Page, testId: string, optionName: string) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

// 右上のフィルターのアイコンを押して、ポップアップを開く。
async function openFilter(page: Page) {
  await page.getByTestId("history-controls-toggle").click();
  await expect(page.getByTestId("history-controls")).toBeVisible();
}

// 適用を押して、ポップアップが閉じるまで待つ。
async function applyFilter(page: Page) {
  await page.getByTestId("history-controls-apply").click();
  await expect(page.getByTestId("history-controls")).toHaveCount(0);
}

const SCORE_DESC = roundsText("historyScoreDirection.desc");
const DATE_ASC = roundsText("historyDateDirection.asc");

// 履歴の1ページ目の取得(起点なし)と続きの取得を数えるため、履歴の関数(rounds_list)の呼び出しを記録する。
function trackRoundsListRequests(page: Page) {
  const bodies: { p_after_id: string | null; p_format: string | null }[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/rpc/rounds_list")
    ) {
      bodies.push(request.postDataJSON());
    }
  });
  return {
    firstPages: () => bodies.filter((body) => body.p_after_id === null).length,
    all: () => bodies.length,
    formats: () => bodies.map((body) => body.p_format),
  };
}

// 履歴の関数の呼び出しを、ラウンド単位(rounds_list)と距離単位(distances_list)に分けて数える。
function trackHistoryRpcRequests(page: Page) {
  const bodies: { name: string; afterId: string | null }[] = [];
  page.on("request", (request) => {
    const name = /\/rpc\/(rounds_list|distances_list)/.exec(request.url())?.[1];
    if (request.method() === "POST" && name) {
      bodies.push({ name, afterId: request.postDataJSON().p_after_id });
    }
  });
  const count = (name: string) =>
    bodies.filter((body) => body.name === name).length;
  return {
    rounds: () => count("rounds_list"),
    distances: () => count("distances_list"),
    all: () => bodies.length,
  };
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 距離単位のカードの表示(ラウンドの名前、実施日と射つ順の番号と距離、小計)を照合する式。
function distanceCard(
  name: string,
  date: string,
  number: number,
  distance: number,
  total: number,
) {
  const line = roundsText("historyDistanceLine", {
    date,
    number: String(number),
    distance: roundsText("historyDistanceMarked", {
      distance: String(distance),
    }),
  });
  const subtotal = roundsText("distanceSubtotal", { total: String(total) });
  return new RegExp(
    `${escapeRegExp(name)}.*${escapeRegExp(line)}.*${escapeRegExp(subtotal)}`,
  );
}

// 屋外の形(各距離6エンド×6射)の距離の行。
function outdoorDistances(...distances: number[]) {
  return distances.map((distance) => ({
    distance,
    totalEnds: 6,
    arrowsPerEnd: 6,
  }));
}

// 完了したラウンドを、実施日が1日ずつ違う`count`件作る(名前の番号が大きいほど新しい)。1ページを越える件数を作るため、準備を並列の束に分ける。
async function addCompletedRounds(
  credentials: Credentials,
  prefix: string,
  count: number,
  options: { format?: "outdoor" | "indoor"; firstIndex?: number } = {},
): Promise<string[]> {
  const first = options.firstIndex ?? 0;
  const names = Array.from(
    { length: count },
    (_, i) => `${prefix}-${String(first + i).padStart(2, "0")}`,
  );
  const batch = 5;
  for (let start = 0; start < names.length; start += batch) {
    await Promise.all(
      names.slice(start, start + batch).map((name, i) =>
        addRound(
          credentials,
          name,
          `2026-04-${String(1 + first + start + i).padStart(2, "0")}`,
          {
            completed: true,
            format: options.format,
            shots: [{ scoreStr: "9", scoreInt: 9 }],
          },
        ),
      ),
    );
  }
  return names;
}

// 一覧の末尾が見えるまで、最後のカードを見える位置へ動かし続けて、続きの自動の取得を起こす。
async function scrollToHistoryEnd(
  page: Page,
  end: "historyEnd" | "historyEndDistance" = "historyEnd",
) {
  await expect(async () => {
    await page.getByRole("listitem").last().scrollIntoViewIfNeeded();
    await expect(page.getByText(roundsText(end))).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });
}

// 対象の最前面の要素が、そのカード自身(の中)であること。座標や寸法の比較ではなく、利用者から隠れていないことを見る。
async function isOnTop(card: Locator) {
  return card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return top !== null && element.contains(top);
  });
}

// 完了や入力中の有無で表示が変わるため、全てのテストは使い捨てのユーザーで前提を作る。
test.describe("履歴", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("履歴を開くと、完了したラウンドが名前・実施日・合計点で表示され、入力中のラウンドは表示されない", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    await addRound(credentials, "入力中の古い", "2026-01-10", {
      shots: [{ scoreStr: "7", scoreInt: 7 }],
    });
    await addRound(credentials, "完了の新しい", "2026-05-01", {
      completed: true,
    });
    await page.goto("/rounds");
    await waitForHydration(page);

    await page
      .getByRole("link", { name: navigationText("leftPanelHistory") })
      .click();

    await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
    const card = page.getByRole("link", { name: /完了の新しい/ });
    await expect(card).toContainText("2026-05-01");
    await expect(card).toContainText(
      roundsText("roundTotalPoints", { total: "0" }),
    );
    await expect(page.getByText("入力中の古い")).toHaveCount(0);
    await expect(page.getByTestId("new-round-fab")).toHaveCount(0);

    // ホームの項目を押すと、ホームへ戻る。
    await page
      .getByRole("link", { name: navigationText("leftPanelHome") })
      .click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(page.getByText("入力中の古い")).toBeVisible();
  });

  test("履歴のURLを直接開いても、履歴が表示される", async ({ page }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    await addRound(credentials, "直接開く", "2026-05-01", { completed: true });

    await page.goto("/rounds/history");

    await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
    await expect(page.getByRole("link", { name: /直接開く/ })).toBeVisible();
  });

  test("履歴のカードから開いた詳細の戻るで履歴へ、ホームのカードから開いた詳細の戻るでホームへ戻る", async ({
    page,
  }) => {
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page, "e2e-history");
    const completedName = `完了-${suffix}`;
    const inProgressName = `入力中-${suffix}`;
    const completedId = await addRound(
      credentials,
      completedName,
      "2026-05-01",
      {
        completed: true,
      },
    );
    const inProgressId = await addRound(
      credentials,
      inProgressName,
      "2026-04-01",
    );

    // 履歴のカードから詳細を開き、戻るで履歴へ戻る。
    await page.goto("/rounds/history");
    await page.getByRole("link", { name: new RegExp(completedName) }).click();
    await expect(page).toHaveURL(new RegExp(`/rounds/${completedId}`));
    await waitForHydration(page);
    await page.getByRole("link", { name: roundsText("back") }).click();
    await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);

    // ホームのカードから詳細を開き、戻るでホームへ戻る。
    await page.goto("/rounds");
    await page.getByRole("link", { name: new RegExp(inProgressName) }).click();
    await expect(page).toHaveURL(`/rounds/${inProgressId}`);
    await waitForHydration(page);
    await page.getByRole("link", { name: roundsText("back") }).click();
    await expect(page).toHaveURL(/\/rounds$/);
  });

  test("完了したラウンドを得点順に並べて種別で絞り込むと、再読み込みと詳細からの戻りで条件が保たれ、リセットで元の並びに戻る", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    await addRound(credentials, "屋外リカーブ", "2026-05-01", {
      completed: true,
      shots: [
        { scoreStr: "10", scoreInt: 10 },
        { scoreStr: "9", scoreInt: 9 },
      ],
    });
    const indoorCompoundId = await addRound(
      credentials,
      "屋内コンパウンド",
      "2026-05-02",
      {
        completed: true,
        format: "indoor",
        bowType: "compound",
        shots: [
          { scoreStr: "10", scoreInt: 10 },
          { scoreStr: "10", scoreInt: 10 },
          { scoreStr: "10", scoreInt: 10 },
        ],
      },
    );
    await addRound(credentials, "屋内リカーブ", "2026-05-03", {
      completed: true,
      format: "indoor",
      shots: [{ scoreStr: "8", scoreInt: 8 }],
    });
    const cards = page.getByRole("listitem");

    // 履歴を開き、フィルターを開いて、日付順を古い順にして適用し、古い順に並べ替える。
    await page.goto("/rounds/history");
    await expect(cards).toHaveText([
      /屋内リカーブ/,
      /屋内コンパウンド/,
      /屋外リカーブ/,
    ]);
    await expect(page.getByTestId("history-controls-active")).toHaveCount(0);
    await openFilter(page);
    await chooseOption(page, "history-sort-date-direction", DATE_ASC);
    await applyFilter(page);
    await expect(cards).toHaveText([
      /屋外リカーブ/,
      /屋内コンパウンド/,
      /屋内リカーブ/,
    ]);

    // フィルターを開き直して、得点順を高い順、種別を屋内にして適用し、一致する2件だけを得点順に表示する。
    await openFilter(page);
    await chooseOption(page, "history-sort-score-direction", SCORE_DESC);
    await chooseOption(
      page,
      "history-filter-format",
      roundsText("formatOption.indoor"),
    );
    await applyFilter(page);
    await expect(cards).toHaveText([/屋内コンパウンド/, /屋内リカーブ/]);

    // 再読み込みしても、入力値が保たれ、アイコンに印が出て、ポップアップは閉じている。
    await page.reload();
    await expect(cards).toHaveText([/屋内コンパウンド/, /屋内リカーブ/]);
    await expect(page.getByTestId("history-controls")).toHaveCount(0);
    await expect(page.getByTestId("history-controls-active")).toHaveCount(1);
    await openFilter(page);
    await expect(page.getByTestId("history-sort-score-direction")).toHaveText(
      SCORE_DESC,
    );
    await expect(page.getByTestId("history-filter-format")).toHaveText(
      roundsText("formatOption.indoor"),
    );
    await page.keyboard.press("Escape");

    // 1件の詳細を開き、戻って履歴へ移っても、条件が保たれる。
    await page.getByRole("link", { name: /屋内コンパウンド/ }).click();
    await expect(page).toHaveURL(new RegExp(`/rounds/${indoorCompoundId}`));
    await waitForHydration(page);
    await page.getByRole("link", { name: roundsText("back") }).click();
    await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
    await expect(cards).toHaveText([/屋内コンパウンド/, /屋内リカーブ/]);
    await expect(page.getByTestId("history-controls")).toHaveCount(0);

    // フィルターを開いてリセットし、適用すると、3件が実施日の新しい順に戻り、印が消える。
    await openFilter(page);
    await page.getByTestId("history-controls-reset").click();
    await applyFilter(page);
    await expect(cards).toHaveText([
      /屋内リカーブ/,
      /屋内コンパウンド/,
      /屋外リカーブ/,
    ]);
    await expect(page.getByTestId("history-controls-active")).toHaveCount(0);
  });

  test("完了したラウンドを期間と得点の範囲で絞り込むと、境界の当日・点を含む一致するラウンドだけが表示され、不正な指定は欄にエラーが出て表示が変わらず、再読み込みで条件が保たれる", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    const rounds = [
      { name: "四月末", date: "2026-04-30", score: 10 },
      { name: "五月初め", date: "2026-05-01", score: 5 },
      { name: "五月中", date: "2026-05-15", score: 9 },
      { name: "五月末", date: "2026-05-31", score: 3 },
      { name: "六月初め", date: "2026-06-01", score: 7 },
    ];
    for (const { name, date, score } of rounds) {
      await addRound(credentials, name, date, {
        completed: true,
        shots: [{ scoreStr: String(score), scoreInt: score }],
      });
    }
    const cards = page.getByRole("listitem");
    const fillRange = (field: string, value: string) =>
      page.getByTestId(`history-filter-${field}`).fill(value);

    // 履歴を開き、期間を5月に絞り込む。開始日・終了日の当日のラウンドも表示される。
    await page.goto("/rounds/history");
    await expect(cards).toHaveCount(5);
    await openFilter(page);
    await fillRange("dateFrom", "2026-05-01");
    await fillRange("dateTo", "2026-05-31");
    await applyFilter(page);
    await expect(cards).toHaveText([/五月末/, /五月中/, /五月初め/]);

    // 得点の範囲を5点以上9点以下にして、期間と合わせて一致する2件だけにする。境界の点のラウンドも表示される。
    await openFilter(page);
    await fillRange("scoreMin", "5");
    await fillRange("scoreMax", "9");
    await applyFilter(page);
    await expect(cards).toHaveText([/五月中/, /五月初め/]);

    // 開始日を終了日より後にして適用するとエラーが出てポップアップは開いたままである。直して適用すると、エラーが消えて絞り込みが更新される。
    await openFilter(page);
    await fillRange("dateFrom", "2026-06-01");
    await page.getByTestId("history-controls-apply").click();
    await expect(page.getByTestId("history-filter-error-dateOrder")).toHaveText(
      roundsText("historyRangeError.dateOrder"),
    );
    await fillRange("dateFrom", "2026-05-02");
    await applyFilter(page);
    await expect(cards).toHaveText([/五月中/]);

    // 再読み込みしても、範囲の条件と入力の値が保たれる。
    await page.reload();
    await expect(cards).toHaveText([/五月中/]);
    await openFilter(page);
    await expect(page.getByTestId("history-filter-dateFrom")).toHaveValue(
      "2026-05-02",
    );
    await expect(page.getByTestId("history-filter-dateTo")).toHaveValue(
      "2026-05-31",
    );
    await expect(page.getByTestId("history-filter-scoreMin")).toHaveValue("5");
    await expect(page.getByTestId("history-filter-scoreMax")).toHaveValue("9");
  });

  test("完了したラウンドを距離の構成で絞り込むと、射つ順と個数が一致するラウンドだけが表示され、不正な指定は欄にエラーが出て表示が変わらず、再読み込みで条件が保たれる", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    // 屋外の形(各距離6エンド×6射)で、距離の構成だけが違う5件を作る。
    const round = (distance: number, targetFaceId = LARGE_FACE_ID) => ({
      distance,
      totalEnds: 6,
      arrowsPerEnd: 6,
      targetFaceId,
    });
    const rounds = [
      { name: "五十から三十", date: "2026-05-01", distances: [50, 30] },
      { name: "三十から五十", date: "2026-05-02", distances: [30, 50] },
      { name: "五十だけ", date: "2026-05-03", distances: [50] },
      {
        name: "五十から三十を2つ",
        date: "2026-05-04",
        distances: [50, 30, 30],
      },
    ];
    for (const { name, date, distances } of rounds) {
      await addRound(credentials, name, date, {
        completed: true,
        distances: distances.map((distance) => round(distance)),
      });
    }
    await addRound(credentials, "的違いの五十", "2026-05-05", {
      completed: true,
      distances: [round(50, SMALL_FACE_ID)],
    });
    const cards = page.getByRole("listitem");
    const summaries = page.getByTestId(/^history-filter-distance-\d+$/);
    const confirmDistance = page.getByTestId("history-distance-dialog-confirm");
    // 「距離を追加」のダイアログで距離を入れて追加し、閉じるまで待つ。
    const addDistance = async (value: string) => {
      await page.getByTestId("history-filter-distance-add").click();
      await page.getByTestId("history-distance-dialog-distance").fill(value);
      await confirmDistance.click();
      await expect(confirmDistance).toHaveCount(0);
    };
    // 要約を押して開いたダイアログで、その行を削除する。
    const deleteDistance = async (index: number) => {
      await summaries.nth(index).click();
      await page.getByTestId("history-distance-dialog-delete").click();
      await expect(confirmDistance).toHaveCount(0);
    };

    // 履歴を開くと5件が実施日の新しい順に表示される。
    await page.goto("/rounds/history");
    await expect(cards).toHaveText([
      /的違いの五十/,
      /五十から三十を2つ/,
      /五十だけ/,
      /三十から五十/,
      /五十から三十/,
    ]);

    // 「距離を追加」で50と30を追加して適用すると、50m→30mの順で2行のラウンドだけが表示される(個数の違う50m→30m→30mは表示されない)。
    await openFilter(page);
    await addDistance("50");
    await addDistance("30");
    await expect(summaries).toHaveCount(2);
    await applyFilter(page);
    await expect(cards).toHaveText([/五十から三十/]);

    // 行を入れ替える操作はないため、先頭の行を削除して50を追加し、30m→50mにして適用すると、逆順のラウンドだけが表示される。
    await openFilter(page);
    await deleteDistance(0);
    await addDistance("50");
    await applyFilter(page);
    await expect(cards).toHaveText([/三十から五十/]);

    // 先頭の行を削除して50mだけにして適用すると、50mの1行のラウンドが表示される。
    await openFilter(page);
    await deleteDistance(0);
    await applyFilter(page);
    await expect(cards).toHaveText([/的違いの五十/, /五十だけ/]);

    // 的を選んで適用すると、その的のラウンドだけに絞られる。的の一覧は端末に保存済みであることを待ち、ポップアップを開き直して読み込む。
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).some((key) =>
            key.startsWith("aims:reference:target-faces:"),
          ),
        ),
      )
      .toBe(true);
    await openFilter(page);
    await summaries.nth(0).click();
    await page.getByTestId("history-distance-dialog-target").click();
    await page.getByTestId(`target-face-option-${LARGE_FACE_ID}`).click();
    await confirmDistance.click();
    await expect(confirmDistance).toHaveCount(0);
    await applyFilter(page);
    await expect(cards).toHaveText([/五十だけ/]);

    // 距離を空のまま追加しようとするとエラーが出てダイアログは開いたままで、閉じても要約は増えず、一覧は変わらない。
    await openFilter(page);
    await page.getByTestId("history-filter-distance-add").click();
    await confirmDistance.click();
    await expect(
      page.getByTestId("history-distance-dialog-error-distanceInvalid"),
    ).toHaveText(roundsText("historyDistanceError.distanceInvalid"));
    await page.keyboard.press("Escape");
    await expect(confirmDistance).toHaveCount(0);
    await expect(summaries).toHaveCount(1);
    await applyFilter(page);
    await expect(cards).toHaveText([/五十だけ/]);

    // 再読み込みしても、距離の構成の行が要約として保たれる。
    await page.reload();
    await expect(cards).toHaveText([/五十だけ/]);
    await openFilter(page);
    await expect(summaries).toHaveCount(1);
    await expect(summaries.nth(0)).toContainText("50m");
    await expect(summaries.nth(0)).not.toContainText(
      roundsText("historyFilterNone"),
    );

    // リセットして適用すると、要約が消えて「距離を追加」だけになり、5件が実施日の新しい順に戻る。
    await page.getByTestId("history-controls-reset").click();
    await expect(summaries).toHaveCount(0);
    await expect(page.getByTestId("history-filter-distance-add")).toBeVisible();
    await applyFilter(page);
    await expect(cards).toHaveText([
      /的違いの五十/,
      /五十から三十を2つ/,
      /五十だけ/,
      /三十から五十/,
      /五十から三十/,
    ]);
  });

  test("距離単位に切り替えると、完了したラウンドの距離が小計付きで1件ずつ表示され、得点順と距離の行・得点の範囲で絞り込める", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    // 距離ごとの小計は、距離に置いた1本の矢の点である。ラウンドの合計点(13、14、2)とは違う値にする。
    await addRound(credentials, "五十から三十", "2026-05-01", {
      completed: true,
      distances: outdoorDistances(50, 30),
      shots: [
        { scoreStr: "9", scoreInt: 9, distanceIndex: 0 },
        { scoreStr: "4", scoreInt: 4, distanceIndex: 1 },
      ],
    });
    await addRound(credentials, "七十から五十", "2026-05-02", {
      completed: true,
      distances: outdoorDistances(70, 50),
      shots: [
        { scoreStr: "6", scoreInt: 6, distanceIndex: 0 },
        { scoreStr: "8", scoreInt: 8, distanceIndex: 1 },
      ],
    });
    await addRound(credentials, "五十だけ", "2026-05-03", {
      completed: true,
      distances: outdoorDistances(50),
      shots: [{ scoreStr: "2", scoreInt: 2 }],
    });
    await addRound(credentials, "入力中の五十", "2026-05-04", {
      distances: outdoorDistances(50),
      shots: [{ scoreStr: "10", scoreInt: 10 }],
    });
    const requests = trackHistoryRpcRequests(page);
    const cards = page.getByRole("listitem");

    // 履歴を開いてラウンド単位の表示を確かめ、距離単位へ切り替える。
    await page.goto("/rounds/history");
    await expect(cards).toHaveText([
      /五十だけ/,
      /七十から五十/,
      /五十から三十/,
    ]);
    await openFilter(page);
    await page.getByTestId("history-unit-toggle").click();
    await applyFilter(page);
    await expect(cards).toHaveText([
      distanceCard("五十だけ", "2026-05-03", 1, 50, 2),
      distanceCard("七十から五十", "2026-05-02", 1, 70, 6),
      distanceCard("七十から五十", "2026-05-02", 2, 50, 8),
      distanceCard("五十から三十", "2026-05-01", 1, 50, 9),
      distanceCard("五十から三十", "2026-05-01", 2, 30, 4),
    ]);
    expect(requests.distances()).toBe(1);
    expect(requests.rounds()).toBe(1);

    // 得点の高い順に並べ替えると、小計の大きい順に並ぶ。
    await openFilter(page);
    await chooseOption(page, "history-sort-score-direction", SCORE_DESC);
    await applyFilter(page);
    await expect(cards).toHaveText([
      distanceCard("五十から三十", "2026-05-01", 1, 50, 9),
      distanceCard("七十から五十", "2026-05-02", 2, 50, 8),
      distanceCard("七十から五十", "2026-05-02", 1, 70, 6),
      distanceCard("五十から三十", "2026-05-01", 2, 30, 4),
      distanceCard("五十だけ", "2026-05-03", 1, 50, 2),
    ]);

    // 距離の行に50mを指定すると、ラウンドの構成によらず50mの距離だけが表示される。
    await openFilter(page);
    await page.getByTestId("history-filter-distance-select").click();
    await page.getByTestId("history-distance-dialog-distance").fill("50");
    await page.getByTestId("history-distance-dialog-confirm").click();
    await expect(
      page.getByTestId("history-distance-dialog-confirm"),
    ).toHaveCount(0);
    await applyFilter(page);
    await expect(cards).toHaveText([
      distanceCard("五十から三十", "2026-05-01", 1, 50, 9),
      distanceCard("七十から五十", "2026-05-02", 2, 50, 8),
      distanceCard("五十だけ", "2026-05-03", 1, 50, 2),
    ]);

    // 得点の範囲を8点以上9点以下にすると、小計が範囲に入る50mの距離だけが表示される。ラウンドの合計点では絞られない。
    await openFilter(page);
    for (const [field, value] of [
      ["scoreMin", "8"],
      ["scoreMax", "9"],
    ]) {
      await page.getByTestId(`history-filter-${field}`).fill(value);
    }
    await applyFilter(page);
    await expect(cards).toHaveText([
      distanceCard("五十から三十", "2026-05-01", 1, 50, 9),
      distanceCard("七十から五十", "2026-05-02", 2, 50, 8),
    ]);
    expect(requests.rounds()).toBe(1);
  });

  test("距離単位の条件は、再読み込みと詳細からの戻りで保たれ、取得し直さず、リセットでラウンド単位に戻る", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    await addRound(credentials, "五十から三十", "2026-05-01", {
      completed: true,
      distances: outdoorDistances(50, 30),
    });
    const roundId = await addRound(credentials, "七十から五十", "2026-05-02", {
      completed: true,
      distances: outdoorDistances(70, 50),
    });
    const requests = trackHistoryRpcRequests(page);
    const cards = page.getByRole("listitem");
    const unitDistance = page.getByTestId("history-unit-toggle");
    const expectedCards = [
      distanceCard("七十から五十", "2026-05-02", 2, 50, 0),
      distanceCard("五十から三十", "2026-05-01", 1, 50, 0),
    ];

    // 距離単位で表示をオンにして、絞り込む距離を50mにして適用する。
    await page.goto("/rounds/history");
    await openFilter(page);
    await unitDistance.click();
    const rowSummary = page.getByTestId("history-filter-distance-row");
    const confirmDistance = page.getByTestId("history-distance-dialog-confirm");
    await page.getByTestId("history-filter-distance-select").click();
    await page.getByTestId("history-distance-dialog-distance").fill("50");
    await confirmDistance.click();
    await expect(confirmDistance).toHaveCount(0);
    await applyFilter(page);
    await expect(cards).toHaveText(expectedCards);

    // 再読み込みしても、単位と距離の行が保たれる。
    await page.reload();
    await expect(cards).toHaveText(expectedCards);
    await openFilter(page);
    await expect(unitDistance).toHaveAttribute("aria-checked", "true");
    await expect(rowSummary).toContainText("50m");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("history-controls")).toHaveCount(0);

    // 件を押して詳細へ移り、戻るリンクで履歴へ戻ると、同じ表示が取得し直されずに残る。
    await cards.first().click();
    await waitForHydration(page);
    await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}`));
    await page.waitForLoadState("networkidle");
    const before = requests.all();
    await page.getByRole("link", { name: roundsText("back") }).click();
    await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
    await expect(cards).toHaveText(expectedCards);
    expect(requests.all()).toBe(before);

    // フィルターを開いて要約から距離を削除すると「距離を選択」に戻り、リセットして適用すると、ラウンド単位で指定なしに戻り、2件がラウンドのカードで表示される。
    await openFilter(page);
    await rowSummary.click();
    await page.getByTestId("history-distance-dialog-delete").click();
    await expect(confirmDistance).toHaveCount(0);
    await expect(
      page.getByTestId("history-filter-distance-select"),
    ).toBeVisible();
    await page.getByTestId("history-controls-reset").click();
    await expect(unitDistance).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByTestId("history-filter-distance-select"),
    ).toHaveCount(0);
    await expect(rowSummary).toHaveCount(0);
    await applyFilter(page);
    await expect(cards).toHaveText([/七十から五十/, /五十から三十/]);
  });

  test("種別の選択を開いたまま弓種を押すと、種別が閉じて弓種の選択が開き、弓種を選べる", async ({
    page,
  }) => {
    await signInFreshUser(page, "e2e-history");
    await page.goto("/rounds/history");
    const indoor = page.getByRole("option", {
      name: roundsText("formatOption.indoor"),
    });
    const compound = page.getByRole("option", {
      name: roundsText("bowTypeOption.compound"),
    });

    // フィルターのポップアップを開き、種別の選択を開いたまま弓種を押すと、種別が閉じて弓種の選択が開き、ポップアップは開いたまま弓種を選べる。
    await openFilter(page);
    await page.getByTestId("history-filter-format").click();
    await expect(indoor).toBeVisible();
    await page.getByTestId("history-filter-bow-type").click();
    await expect(compound).toBeVisible();
    await expect(indoor).toHaveCount(0);
    await expect(page.getByTestId("history-controls")).toBeVisible();
    await compound.click();
    await expect(page.getByTestId("history-filter-bow-type")).toHaveText(
      roundsText("bowTypeOption.compound"),
    );

    // 選択を開いたまま距離単位で表示を押すと、距離単位で表示がオンになる。
    await page.getByTestId("history-filter-format").click();
    await expect(indoor).toBeVisible();
    await page.getByTestId("history-unit-toggle").click();
    await expect(page.getByTestId("history-unit-toggle")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("距離単位のカードを押すと、複数の距離を持つラウンドの2番目の距離でも、そのラウンドの詳細へ移り、戻るリンクで履歴へ戻る", async ({
    page,
  }) => {
    const credentials = await signInFreshUser(page, "e2e-history");
    const roundId = await addRound(credentials, "七十から五十", "2026-05-02", {
      completed: true,
      distances: outdoorDistances(70, 50),
    });
    await page.goto("/rounds/history");
    await openFilter(page);
    await page.getByTestId("history-unit-toggle").click();
    await applyFilter(page);
    const secondDistance = page.getByRole("link").filter({
      hasText: distanceCard("七十から五十", "2026-05-02", 2, 50, 0),
    });

    // 2番目の距離のカードを押して、そのラウンドの詳細へ移る。
    await secondDistance.click();
    await waitForHydration(page);
    await expect(page).toHaveURL(new RegExp(`/rounds/${roundId}`));
    await expect(page.getByTestId("round-config-summary")).toContainText(
      "七十から五十",
    );

    // 戻るリンクで履歴へ戻る。
    await page.getByRole("link", { name: roundsText("back") }).click();
    await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
    await expect(secondDistance).toBeVisible();
  });

  test("オフラインで入力を完了するとホームから消えて履歴にも出ず、オンラインに戻って同期された後に履歴を開くと1件だけ表示される", async ({
    page,
    context,
  }) => {
    // 入力中のラウンドが2件あるホームを開く。
    const suffix = `${Date.now()}`;
    const credentials = await signInFreshUser(page, "e2e-history");
    const completingName = `完了にする-${suffix}`;
    const remainingName = `残る-${suffix}`;
    const completingId = await addRound(
      credentials,
      completingName,
      "2026-03-01",
    );
    await addRound(credentials, remainingName, "2026-02-01");
    await page.goto("/rounds");
    await expect(page.getByText(remainingName)).toBeVisible();

    // 1件をラウンド詳細で開き、オフラインで入力を完了してホームへ移る。
    await page.getByText(completingName).click();
    await waitForHydration(page);
    await waitForServiceWorkerControl(page);
    await goOffline(context);
    await page.getByTestId("complete-round-button").click();
    await page.getByTestId("confirm-dialog-confirm").click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(page.getByText(remainingName)).toBeVisible();
    await expect(page.getByText(completingName)).toHaveCount(0);

    // オンラインに戻り、完了がサーバーへ届くのを待ってから、履歴に1件だけ出るのを確かめる。
    await comeBackOnline(context, page);
    const { supabase } = await openOtherDevice(
      credentials.email,
      credentials.password,
    );
    await expect
      .poll(async () => (await getRoundRow(supabase, completingId)).status, {
        timeout: 15_000,
      })
      .toBe("completed");
    await page
      .getByRole("link", { name: navigationText("leftPanelHistory") })
      .click();
    await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
    await expect(page.getByText(completingName)).toHaveCount(1);
    await expect(page.getByText(remainingName)).toHaveCount(0);
  });
  // 1ページの件数は画面の高さで決まる。高さを低く固定し、最小の件数(10件)を1ページとして、25件が複数ページになるようにする。
  test.describe("ページ送り", () => {
    test.use({ viewport: { width: 1280, height: 360 } });
    test.setTimeout(120_000);

    test("1ページを越える完了したラウンドは、最初は一部だけ表示され、末尾までスクロールすると続きが重複なく表示され、最後に以上の文言が表示される", async ({
      page,
    }) => {
      const credentials = await signInFreshUser(page, "e2e-history");
      await addCompletedRounds(credentials, "続き", 25);
      const cards = page.getByRole("listitem");

      // 履歴を開くと、最初は全件でなく一部だけが表示される。
      await page.goto("/rounds/history");
      await expect(cards.first()).toBeVisible();
      expect(await cards.count()).toBeLessThan(25);
      await expect(page.getByText(roundsText("historyEnd"))).toHaveCount(0);

      // 末尾までスクロールすると、続きが取得されて全件が重複なく並び、以上の文言が出る。
      await scrollToHistoryEnd(page);
      await expect(cards).toHaveCount(25);
      const texts = await cards.allTextContents();
      expect(new Set(texts).size).toBe(25);
    });

    test("距離単位でも、1ページを越える件は、末尾までスクロールすると続きが距離ごとに重複なく表示され、最後に以上の文言が表示される", async ({
      page,
    }) => {
      const credentials = await signInFreshUser(page, "e2e-history");
      // 4距離のラウンド6件で24件。1ページは最小の10件のため、ページの境界が同じラウンドの距離の途中に来る。
      const names = Array.from({ length: 6 }, (_, i) => `距離ページ-${i}`);
      await Promise.all(
        names.map((name, i) =>
          addRound(
            credentials,
            name,
            `2026-04-${String(1 + i).padStart(2, "0")}`,
            {
              completed: true,
              distances: outdoorDistances(70, 60, 50, 30),
            },
          ),
        ),
      );
      const cards = page.getByRole("listitem");

      // 距離単位で履歴を開くと、最初は全件でなく一部だけが表示される。
      await page.goto("/rounds/history");
      await openFilter(page);
      await page.getByTestId("history-unit-toggle").click();
      await applyFilter(page);
      await expect(cards.first()).toBeVisible();
      expect(await cards.count()).toBeLessThan(24);
      await expect(
        page.getByText(roundsText("historyEndDistance")),
      ).toHaveCount(0);

      // 末尾までスクロールすると、続きが取得されて24件が重複なく並び、距離単位の以上の文言が出る。
      await scrollToHistoryEnd(page, "historyEndDistance");
      await expect(cards).toHaveCount(24);
      const texts = await cards.allTextContents();
      expect(new Set(texts).size).toBe(24);
      for (const name of names) {
        await expect(cards.filter({ hasText: name })).toHaveCount(4);
      }

      // スクロールしても、フィルターのアイコンは一覧の項目に隠れず、押せる最前面にある。
      const toggle = page.getByTestId("history-controls-toggle");
      const isFront = await toggle.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const front = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return front !== null && element.contains(front);
      });
      expect(isFront).toBe(true);
    });

    test("後ろのページにある条件に一致するラウンドも、得点順に並べて種別で絞り込むと先頭側に表示され、条件を変えるたびに先頭から取得し直される", async ({
      page,
    }) => {
      const credentials = await signInFreshUser(page, "e2e-history");
      // 屋外22件の後ろ(古い側)に、屋内3件を置く。
      await addCompletedRounds(credentials, "屋外", 22, { firstIndex: 3 });
      await addCompletedRounds(credentials, "屋内", 3, { format: "indoor" });
      const requests = trackRoundsListRequests(page);
      const cards = page.getByRole("listitem");
      await page.goto("/rounds/history");
      await expect(cards.first()).toBeVisible();
      await expect(page.getByText(/屋内-/)).toHaveCount(0);

      // 得点の高い順に並べ替えて、先頭から取得し直す。
      await openFilter(page);
      await chooseOption(page, "history-sort-score-direction", SCORE_DESC);
      await applyFilter(page);
      await expect.poll(() => requests.firstPages()).toBe(2);

      // 種別を屋内に絞り込むと、後ろのページにあった屋内3件だけが先頭から表示される。
      await openFilter(page);
      await chooseOption(
        page,
        "history-filter-format",
        roundsText("formatOption.indoor"),
      );
      await applyFilter(page);
      // 得点が同じため、実施日の新しい順になる。
      await expect(cards).toHaveText([/屋内-02/, /屋内-01/, /屋内-00/]);
      await expect.poll(() => requests.formats()).toContain("indoor");
      await expect(page.getByText(roundsText("historyEnd"))).toBeVisible();
    });

    test("履歴の項目を押すと、他の端末で完了したラウンドを含む最新を、先頭から1回だけ取得して表示する", async ({
      page,
    }) => {
      const credentials = await signInFreshUser(page, "e2e-history");
      await addRound(credentials, "もとからある", "2026-04-01", {
        completed: true,
      });
      const requests = trackRoundsListRequests(page);
      await page.goto("/rounds/history");
      await expect(page.getByText("もとからある")).toBeVisible();
      await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
      await page.waitForLoadState("networkidle");
      const before = requests.firstPages();

      // 他の端末で1件を完了にしてから、履歴の項目を押す。
      await addRound(credentials, "あとから完了", "2026-04-02", {
        completed: true,
      });
      await page
        .getByRole("link", { name: navigationText("leftPanelHistory") })
        .click();

      // 足したラウンドが表示され、先頭の取得は1回だけで、URLは戻りの印付きになる。
      await expect(page.getByText("あとから完了")).toBeVisible();
      await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
      await page.waitForLoadState("networkidle");
      expect(requests.firstPages()).toBe(before + 1);
    });

    test("続きまでスクロールして開いた詳細の戻るリンクで戻ると、離れる前の表示が残り、同じラウンドが見え、取得し直さない", async ({
      page,
    }) => {
      const credentials = await signInFreshUser(page, "e2e-history");
      await addCompletedRounds(credentials, "復元", 25);
      const requests = trackRoundsListRequests(page);
      await page.goto("/rounds/history");
      await expect(page.getByRole("listitem").first()).toBeVisible();

      // 続きまで読み込み、最後のカードの詳細を開く。
      await scrollToHistoryEnd(page);
      const last = page.getByRole("link", { name: /復元-00/ });
      await last.click();
      await waitForHydration(page);
      await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]{36}/);
      await page.waitForLoadState("networkidle");
      const before = requests.all();

      // 戻るリンクで履歴へ戻る。
      await page.getByRole("link", { name: roundsText("back") }).click();
      await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);

      // 全件が残り、開いたラウンドが隠れずに見え、取得は増えない。
      await expect(page.getByRole("listitem")).toHaveCount(25);
      await expect
        .poll(() => isOnTop(page.getByRole("link", { name: /復元-00/ })))
        .toBe(true);
      expect(requests.all()).toBe(before);
    });

    test("履歴から詳細へ移ってブラウザの戻るで履歴に戻ると離れる前の表示になり、進むと詳細に戻り、取得し直さない", async ({
      page,
    }) => {
      const credentials = await signInFreshUser(page, "e2e-history");
      await addCompletedRounds(credentials, "履歴戻り", 25);
      const requests = trackRoundsListRequests(page);
      await page.goto("/rounds/history");
      await scrollToHistoryEnd(page);
      await page.getByRole("link", { name: /履歴戻り-00/ }).click();
      await waitForHydration(page);
      await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]{36}/);
      await page.waitForLoadState("networkidle");
      const before = requests.all();

      // ブラウザの戻るで履歴に戻る。
      await page.goBack();
      await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
      await expect(page.getByRole("listitem")).toHaveCount(25);
      await expect
        .poll(() => isOnTop(page.getByRole("link", { name: /履歴戻り-00/ })))
        .toBe(true);

      // 進むと詳細に戻る。
      await page.goForward();
      await expect(page).toHaveURL(/\/rounds\/[0-9a-f-]{36}/);
      expect(requests.all()).toBe(before);
    });

    test("履歴で完了したラウンドを削除すると、どのページにも表示されない", async ({
      page,
    }) => {
      const credentials = await signInFreshUser(page, "e2e-history");
      await addCompletedRounds(credentials, "削除", 25);
      await page.goto("/rounds/history");
      const first = page.getByRole("listitem").first();
      await expect(first).toContainText("削除-24");

      // 先頭のカードのメニューから削除する。
      await first.getByTestId("round-menu-trigger").click();
      await page.getByTestId("round-delete").click();
      await page.getByTestId("confirm-dialog-confirm").click();

      // 末尾までスクロールしても、削除したラウンドは出ない。
      await scrollToHistoryEnd(page);
      await expect(page.getByRole("listitem")).toHaveCount(24);
      await expect(page.getByText("削除-24")).toHaveCount(0);
    });

    test("ホームで入力中のラウンドを削除しても、履歴のどのページにも表示されない", async ({
      page,
    }) => {
      const credentials = await signInFreshUser(page, "e2e-history");
      await addCompletedRounds(credentials, "完了", 25);
      await addRound(credentials, "入力中を削除", "2026-05-01");
      await page.goto("/rounds");
      const row = page
        .getByRole("listitem")
        .filter({ hasText: "入力中を削除" });
      await expect(row).toBeVisible();

      // ホームのカードのメニューから削除する。
      await row.getByTestId("round-menu-trigger").click();
      await page.getByTestId("round-delete").click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await expect(row).toHaveCount(0);

      // 履歴を末尾まで見ても、完了の25件だけが並ぶ。
      await page
        .getByRole("link", { name: navigationText("leftPanelHistory") })
        .click();
      await scrollToHistoryEnd(page);
      await expect(page.getByRole("listitem")).toHaveCount(25);
      await expect(page.getByText("入力中を削除")).toHaveCount(0);
    });

    test("他の端末で完了し、端末にはまだ入力中として残るラウンドは、同期が取り込むまで履歴に表示されない", async ({
      page,
    }) => {
      const credentials = await signInFreshUser(page, "e2e-history");
      await addRound(credentials, "既に完了", "2026-03-01", {
        completed: true,
      });
      const pendingId = await addRound(
        credentials,
        "取り込み待ち",
        "2026-03-02",
      );
      await page.goto("/rounds");
      await expect(page.getByText("取り込み待ち")).toBeVisible();

      // 他の端末で完了にしてから、画面を移って履歴を開く。端末にはまだ入力中として残る。
      const { supabase } = await openOtherDevice(
        credentials.email,
        credentials.password,
      );
      await updateRound(supabase, pendingId, { status: "completed" });
      await page
        .getByRole("link", { name: navigationText("leftPanelHistory") })
        .click();
      await expect(page.getByText("既に完了")).toBeVisible();
      await expect(page.getByText("取り込み待ち")).toHaveCount(0);

      // ホームを開き直して同期が取り込むと、履歴に表示される。
      await page.goto("/rounds");
      await expect(page.getByText("取り込み待ち")).toHaveCount(0);
      await page
        .getByRole("link", { name: navigationText("leftPanelHistory") })
        .click();
      await expect(page.getByText("取り込み待ち")).toBeVisible();
    });

    test("別の利用者でサインインして履歴を開くと、前の利用者の表示でなく最新を取得して表示する", async ({
      page,
    }) => {
      const first = await signInFreshUser(page, "e2e-history");
      await addRound(first, "前の利用者", "2026-04-01", { completed: true });
      await page.goto("/rounds/history");
      await expect(page.getByText("前の利用者")).toBeVisible();

      // サインアウトして、別の利用者でサインインする。
      await signOutFromSettings(page);
      const second = await signInFreshUser(page, "e2e-history");
      await addRound(second, "次の利用者", "2026-04-02", { completed: true });
      await page.goto("/rounds/history");

      await expect(page.getByText("次の利用者")).toBeVisible();
      await expect(page.getByText("前の利用者")).toHaveCount(0);
    });
  });
});

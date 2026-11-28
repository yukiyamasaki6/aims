import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { targetFaceDescription } from "@/features/rounds/ui/target-face-label-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { FRAME_PATHS, shellUrlOf } from "@/routes";
import { expect, test } from "../fixtures";
import {
  SHARED_AUTH_STATE_PATH,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { collectHydrationErrors } from "../helpers/hydration";
import { expectNoPendingOps, expectNoUnackedOps } from "../helpers/op-log";
import { openOtherDevice } from "../helpers/other-device";
import { expectRoundBasesFetched } from "../helpers/reference-data";
import { addRound, createPreparedUser } from "../helpers/round-fixtures";
import { expectCells, expectPointedCell } from "../helpers/score-cells";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { homeHeading } from "../helpers/settings";

const authText = translatorFor("auth");
const offlinePwaText = translatorFor("offlinePwa");
const roundsText = translatorFor("rounds");

// 認証に依存しない/を使い、Service Workerが有効になるまで待つ。
async function openWithServiceWorker(page: Page) {
  await page.goto("/");
  // 初回の読み込みと登録処理が落ち着く前に別のService Workerを登録すると、
  // 新しいService Workerが待機したままになることがあるため、通信の完了を待つ。
  await page.waitForLoadState("networkidle");
  // 有効化直後のclients.claim()でページが制御されるまで待つ。/には水和の完了を表す要素がない。
  await waitForServiceWorkerControl(page, { waitForHydration: false });
}

// Serwistのプリキャッシュに入っているURLの一覧を返す。
async function precachedUrls(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) =>
      name.startsWith("serwist-precache"),
    );
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
}

// プリキャッシュに入る画面の枠。proxy.tsの対象外の/__shell/*で配られる。
const SHELL_URLS = FRAME_PATHS.map(shellUrlOf);

test("未認証で紹介画面を開くと画面の枠が保存され、サインインした後にオフラインでホームと履歴を開くと、サインイン画面ではなくそれぞれの枠が表示され、ホームには入力中のラウンドがない旨、履歴には「ネットワークに接続されていません」が表示される", async ({
  page,
  context,
}) => {
  // 未認証で紹介画面を開き、Service Workerが静的アセットと/offlineと画面の枠を保存したことを確かめる。
  const errors = collectHydrationErrors(page);
  await openWithServiceWorker(page);
  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state;
  });
  expect(registered).toBe("activated");
  const urls = await precachedUrls(page);
  expect(urls.some((url) => url.includes("/_next/static/"))).toBe(true);
  expect(urls.some((url) => url.includes("/offline"))).toBe(true);
  expect(urls.some((url) => url.endsWith(".woff2"))).toBe(true);
  for (const frame of SHELL_URLS) {
    expect(
      urls.some((url) => url.includes(`${frame}?__WB_REVISION__=`)),
      `${frame}がプリキャッシュにあること`,
    ).toBe(true);
  }

  // 保存された枠の本文に、サインイン画面にだけある入力欄がないこと(/signinのHTMLが枠として保存されていないこと)。
  const frameBodies = await page.evaluate(async (frames) => {
    const name = (await caches.keys()).find((n) =>
      n.startsWith("serwist-precache"),
    ) as string;
    const cache = await caches.open(name);
    const bodies: Record<string, string> = {};
    for (const request of await cache.keys()) {
      const frame = frames.find((f) =>
        request.url.includes(`${f}?__WB_REVISION__=`),
      );
      if (frame)
        bodies[frame] = (await (await cache.match(request))?.text()) ?? "";
    }
    return bodies;
  }, SHELL_URLS);
  for (const frame of SHELL_URLS) {
    const body = frameBodies[frame];
    expect(body, `${frame}の本文`).toBeTruthy();
    expect(body, `${frame}にサインインのメール入力欄がないこと`).not.toContain(
      `placeholder="${authText("emailPlaceholder")}"`,
    );
    expect(body, `${frame}にパスワード入力欄がないこと`).not.toContain(
      'placeholder="パスワード"',
    );
  }
  expect(frameBodies["/__shell/rounds"], "ホームの枠の本文").toContain(
    roundsText("newRoundLabel"),
  );

  // 入力中のラウンドが端末に無い使い捨てのユーザーでサインインし、ホームへ進む。
  await signUpAndSignIn(page, {
    email: `e2e-offline-list-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`,
    password: "password-e2e-offline-list",
  });

  // オフラインでホームを開き、Service Workerが返したホームの枠と入力中のラウンドがない旨が表示され、サインイン画面と取得の失敗の表示が出ないことを確かめる。
  await goOffline(context);
  const response = await page.goto("/rounds");
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page).toHaveURL(/\/rounds$/);
  await expect(homeHeading(page)).toBeVisible();
  await expect(page.getByText(roundsText("homeEmpty"))).toBeVisible();
  await expect(page.getByText(roundsText("fetchOffline"))).toHaveCount(0);
  await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);
  await expect(page.getByPlaceholder(authText("emailPlaceholder"))).toHaveCount(
    0,
  );
  expect(errors, "ハイドレーションエラーがないこと").toEqual([]);

  // オフラインで履歴を開き、Service Workerが返した履歴の枠と「ネットワークに接続されていません」が表示され、サインイン画面とラウンドの無い表示が出ないことを確かめる。
  const historyResponse = await page.goto("/rounds/history");
  expect(historyResponse?.fromServiceWorker()).toBe(true);
  await expect(page).toHaveURL(/\/rounds\/history\?return=1$/);
  await expect(page.getByText(roundsText("fetchOffline"))).toBeVisible();
  await expect(page.getByText(roundsText("historyEmpty"))).toHaveCount(0);
  await expect(page.getByPlaceholder("you@example.com")).toHaveCount(0);
  expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
});

test("Service Workerが登録済みでオフラインのとき、紹介画面を開くと、オフラインのページが表示される", async ({
  page,
  context,
}) => {
  // /はプリキャッシュ対象外のため、
  // ナビゲーションの失敗を認証に依存しない静的な/offlineで受け止める。
  await openWithServiceWorker(page);
  await context.setOffline(true);

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: offlinePwaText("offlineTitle") }),
  ).toBeVisible();
  await expect(
    page.getByText(offlinePwaText("offlineDescription")),
  ).toBeVisible();
});

// 公式の的: ラウンドの準備で使うアウトドア・122cmと、選び直し先のアウトドア・80cmの5〜10点。
const OUTDOOR_122CM_FACE_ID = "a1000000-0000-0000-0000-000000000001";
const OUTDOOR_80CM_FIVE_ZONE_FACE_ID = "a1000000-0000-0000-0000-000000000003";
const OUTDOOR_80CM_FIVE_ZONE_DESCRIPTION = targetFaceDescription({
  format: "outdoor",
  size: 80,
  bowTypes: ["recurve", "compound", "barebow"],
  minScore: 5,
  maxScore: 10,
  hasX: true,
  tenRadius: 4,
  placement: "single",
});

// 現在と取得する項目の並びが違う的の取得のselect(配置が無く、名称を持つ)。
const TARGET_FACE_SELECT_WITH_NAME =
  "id, name, size, format, bow_type, target_face_spots(center_x, center_y, target_face_rings(radius, color, line_color, z_index, score_str, score_int))";

// ケースだけの利用者と未記録のラウンドを用意して詳細を開き、的の一覧とラウンドが端末に保存され、Service Workerがページを制御するまで待つ。
async function openRoundSavedOnDevice(page: Page) {
  const credentials = await createPreparedUser(page, "e2e-offline-face");
  const roundId = await addRound(credentials, "オフラインの的", "2026-08-24");
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expect(page.getByTestId("round-summary")).toBeVisible();
  await expectRoundBasesFetched(page, { roundId });
  await waitForServiceWorkerControl(page);
  await expect(page.getByTestId("round-summary")).toBeVisible();
  return { credentials, roundId };
}

// 端末の的の保存を、取得する項目の並びが違う形(別のselectのshapeで、的は名称を持ち配置が無い)へ書き換える。
async function replaceSavedTargetFacesWithDifferentShape(page: Page) {
  await page.evaluate((shape) => {
    for (const [key, value] of Object.entries(localStorage)) {
      if (!key.startsWith("aims:reference:target-faces:")) continue;
      const stored = JSON.parse(value) as {
        startedAt: number;
        data: { placement?: string }[];
      };
      const data = stored.data.map(({ placement: _, ...face }) => ({
        ...face,
        name: "項目の並びが違う的",
      }));
      localStorage.setItem(key, JSON.stringify({ ...stored, shape, data }));
    }
  }, TARGET_FACE_SELECT_WITH_NAME);
}

// サーバーに保存された、ラウンドの唯一の距離の的と、生きている矢("エンド-マスの番号:点数"の文字列の順)。
async function savedDistance(supabase: SupabaseClient, roundId: string) {
  const { data, error } = await supabase
    .from("distances")
    .select(
      "target_face_id, shots(end_number, shot_number, score_str, disabled_at)",
    )
    .eq("round_id", roundId)
    .single();
  if (error) throw error;
  return {
    targetFaceId: data.target_face_id as string,
    shots: data.shots
      .filter((shot) => shot.disabled_at === null)
      .map((shot) => `${shot.end_number}-${shot.shot_number}:${shot.score_str}`)
      .sort(),
  };
}

test("的の一覧を端末に保存していると、オフラインで的を選び直して点数を記録でき、オンラインに戻ると保存される", async ({
  page,
  context,
}) => {
  const { credentials, roundId } = await openRoundSavedOnDevice(page);

  // オフラインでラウンドを開き直し、端末の内容が表示されることを確かめる。
  await goOffline(context);
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expect(page.getByTestId("round-summary")).toBeVisible();

  // 距離の的を読み上げの説明で選び直して保存し、選んだ的の点数のキーに変わることを確かめる。
  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("target-face-picker-trigger").click();
  await page
    .getByRole("button", {
      name: OUTDOOR_80CM_FIVE_ZONE_DESCRIPTION,
      exact: true,
    })
    .click();
  await expect(
    page.getByTestId("target-face-picker-trigger"),
  ).toHaveAccessibleName(
    roundsText("targetFaceTrigger", {
      name: OUTDOOR_80CM_FIVE_ZONE_DESCRIPTION,
    }),
  );
  await page.getByTestId("distance-config-save-1").click();
  await expect(page.getByTestId("distance-config-save-1")).toBeHidden();
  await expect(page.getByTestId("score-button-5")).toBeVisible();
  await expect(page.getByTestId("score-button-4")).toHaveCount(0);

  // 点数を1本記録し、マスに表示されることを確かめる。
  await page.getByTestId("score-button-5").click();
  await expectCells(page, 1, 1, ["5", null, null]);

  // オンラインに戻り、選び直した的と矢が保存されることを確かめる。
  await comeBackOnline(context, page);
  const { supabase } = await openOtherDevice(
    credentials.email,
    credentials.password,
  );
  await expect
    .poll(() => savedDistance(supabase, roundId), { timeout: 30_000 })
    .toEqual({
      targetFaceId: OUTDOOR_80CM_FIVE_ZONE_FACE_ID,
      shots: ["1-1:5"],
    });
});

test("取得する項目の並びが違う的の保存しかない端末は、オフラインではラウンド詳細に「ネットワークに接続されていません」が表示されて入力できず、オンラインに戻ると内容が表示されて入力を再開できる", async ({
  page,
  context,
}) => {
  const { credentials, roundId } = await openRoundSavedOnDevice(page);
  const { supabase } = await openOtherDevice(
    credentials.email,
    credentials.password,
  );

  // オンラインで1本記録し、サーバーに保存されて、端末が送信の確定を保存するまで進む。
  await page.getByTestId("score-button-9").click();
  await expectCells(page, 1, 1, ["9", null, null]);
  await expect
    .poll(() => savedDistance(supabase, roundId), { timeout: 30_000 })
    .toEqual({ targetFaceId: OUTDOOR_122CM_FACE_ID, shots: ["1-1:9"] });
  await expectNoUnackedOps(page, roundId);

  // オンラインのまま読み込み直し、開く取得が確定済みの操作を端末の列から外すまで進む。
  await page.reload();
  await waitForHydration(page);
  await expectNoPendingOps(page, roundId);

  // オフラインで詳細を開き直し、端末の内容が表示されることを確かめる。
  await goOffline(context);
  // オンラインの文書を破棄し、遅れた的の取得が次の書き換えを戻さないようにする。
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);
  await expect(page.getByTestId("round-summary")).toBeVisible();

  // 的の保存を項目の並びが違う形にして読み込み直し、内容とテンキーが表示されないことを確かめる。
  await replaceSavedTargetFacesWithDifferentShape(page);
  // 内容を出さない間は水和の属性が付かないため、水和を待たない。
  await page.reload();
  await expect(page.getByText(roundsText("fetchOffline"))).toBeVisible();
  await expect(page.getByTestId("round-summary")).toHaveCount(0);
  await expect(page.getByTestId(/^score-button-/)).toHaveCount(0);

  // オンラインに戻り、記録を含む内容が表示されて、次のマスから入力できることを確かめる。
  await comeBackOnline(context, page);
  await expect(page.getByTestId("round-summary")).toBeVisible();
  await expect(page.getByText(roundsText("fetchOffline"))).toHaveCount(0);
  await expectCells(page, 1, 1, ["9", null, null]);
  await expectPointedCell(page, 1, 1, 2);

  // 2本目を記録し、2本とも保存されることを確かめる。
  await page.getByTestId("score-button-8").click();
  await expectCells(page, 1, 1, ["9", "8", null]);
  await expect
    .poll(() => savedDistance(supabase, roundId), { timeout: 30_000 })
    .toEqual({
      targetFaceId: OUTDOOR_122CM_FACE_ID,
      shots: ["1-1:9", "1-2:8"],
    });
});

test.describe("認証済みで開く", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("プリセットを端末に保存していないとき、オフラインでラウンドの作成を開くと、枠と「ネットワークに接続されていません」が表示され、オンラインに戻るとプリセット一覧が表示される", async ({
    page,
    context,
  }) => {
    // オフラインでラウンドの作成を開き、Service Workerが返した枠と「ネットワークに接続されていません」を確かめる。
    const errors = collectHydrationErrors(page);
    await openWithServiceWorker(page);
    await goOffline(context);
    const response = await page.goto("/rounds/new");
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.getByTestId("round-start-button")).toBeVisible();
    await expect(page.getByText(roundsText("fetchOffline"))).toBeVisible();
    expect(errors, "ハイドレーションエラーがないこと").toEqual([]);

    // オンラインに戻り、プリセット一覧が表示されることを確かめる。
    await comeBackOnline(context, page);
    await expect(page.getByTestId("round-preset-button").first()).toBeVisible();
    await expect(page.getByText(roundsText("fetchOffline"))).toHaveCount(0);
  });
});

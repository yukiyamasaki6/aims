import { expect, test } from "../fixtures";
import { signUpAndSignIn, waitForHydration } from "../helpers/auth";
import { createRound } from "../helpers/rounds";

test("「プリセット保存」ボタンをクリックするとプリセット保存ダイアログを表示する", async ({
  page,
}) => {
  const email = `save-as-preset-trigger-${Date.now()}@aims.test`;
  const password = "password-save-preset-trigger";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "ダイアログ表示テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();

  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();
});

test("プリセット保存ダイアログは、プリセット名の入力欄に距離構成から自動生成した名前をプレースホルダーとして表示する", async ({
  page,
}) => {
  const email = `save-as-preset-placeholder-${Date.now()}@aims.test`;
  const password = "password-save-preset-placeholder";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [
      { distance: 30, totalEnds: 3, arrowsPerEnd: 6 },
      { distance: 30, totalEnds: 3, arrowsPerEnd: 6 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  const nameInput = page.getByTestId("save-as-preset-name");
  await expect(nameInput).toHaveAttribute("placeholder", "30-30");
  await expect(nameInput).toHaveValue("");
});

test("プリセット名が空のまま保存すると、プレースホルダーの値で保存される", async ({
  page,
}) => {
  const email = `save-as-preset-autoname-${Date.now()}@aims.test`;
  const password = "password-save-preset-autoname";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [
      { distance: 30, totalEnds: 3, arrowsPerEnd: 6 },
      { distance: 30, totalEnds: 3, arrowsPerEnd: 6 },
    ],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  await expect(
    page.getByTestId("round-preset-button").filter({ hasText: "30-30" }),
  ).toBeVisible();
});

test("ラウンド名が設定されている場合、プリセット名欄にラウンド名が事前入力される", async ({
  page,
}) => {
  const email = `save-as-preset-roundname-${Date.now()}@aims.test`;
  const password = "password-save-preset-roundname";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "県予選2026",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  const nameInput = page.getByTestId("save-as-preset-name");
  await expect(nameInput).toHaveValue("県予選2026");
  await expect(nameInput).toHaveAttribute("placeholder", "30");
  await page.getByTestId("save-as-preset-confirm").click();
  await expect(nameInput).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  await expect(
    page.getByTestId("round-preset-button").filter({ hasText: "県予選2026" }),
  ).toBeVisible();
});

test("プリセット保存ダイアログの背景をクリックすると閉じる", async ({
  page,
}) => {
  const email = `save-as-preset-outside-${Date.now()}@aims.test`;
  const password = "password-save-preset-outside";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "背景クリックテスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();

  await page.mouse.click(5, 5);

  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();
});

test("プリセット保存の送信中は保存ボタンが無効になり、背景クリックでダイアログを閉じられない", async ({
  page,
}) => {
  const email = `save-as-preset-submitting-${Date.now()}@aims.test`;
  const password = "password-save-preset-submitting";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "送信中無効化テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  let requestCount = 0;
  let releaseRequest: () => void = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/rest/v1/rpc/save_round_as_preset", async (route) => {
    requestCount++;
    await requestGate;
    await route.continue();
  });

  await page.getByTestId("save-as-preset-trigger").click();
  const confirmButton = page.getByTestId("save-as-preset-confirm");
  await confirmButton.click();

  await expect(confirmButton).toHaveAttribute("aria-disabled", "true");

  // sync.flush()の解決を挟むため、保存リクエスト自体が実際に送信される
  // （ゲートに到達する）までのラグがある。
  await expect.poll(() => requestCount).toBe(1);

  // 無効化が実際にクリックを防いでいることを確認する。
  await confirmButton.click({ force: true });
  expect(requestCount).toBe(1);

  // 背景クリックでも閉じない。
  await page.mouse.click(5, 5);
  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();

  releaseRequest();
});

// 保存したプリセットが共有アカウントの個人プリセット一覧に残り続けると、
// 他のテスト（個人プリセット0件の検証等）に影響するため、専用ユーザーで行う。
test("現在の構成を個人プリセットとして保存でき、/rounds/newの選択肢に表示される", async ({
  page,
}) => {
  const email = `save-as-preset-${Date.now()}@aims.test`;
  const password = "password-save-preset";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "保存元ラウンド",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("マイプリセットA");
  await page.getByTestId("save-as-preset-confirm").click();

  // 保存成功時はダイアログが閉じる。
  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();

  await page.goto("/rounds/new");
  await waitForHydration(page);
  await expect(page.getByTestId("personal-preset-placeholder")).toBeHidden();

  const presetButton = page
    .getByTestId("round-preset-button")
    .filter({ hasText: "マイプリセットA" });
  await presetButton.click();

  const presetCard = presetButton.locator("..");
  await expect(presetCard).toContainText("30m");
  await expect(presetCard).toContainText("6本×3エンド");
});

test("距離を編集した直後にプリセット保存すると、直前の変更の反映を待ってから保存される", async ({
  page,
}) => {
  const email = `save-as-preset-race-${Date.now()}@aims.test`;
  const password = "password-save-preset-race";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "直後保存元",
    roundDate: "2026-08-24",
    format: "field",
    bowType: "recurve",
    distances: [{ distance: 18, totalEnds: 2, arrowsPerEnd: 3 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  // 距離の更新リクエストを意図的に遅延させ、直後のプリセット保存の
  // リクエスト自体がその反映を待たずに送られてしまわないかを検証する。
  let releaseDistanceUpdate: () => void = () => {};
  const distanceUpdateGate = new Promise<void>((resolve) => {
    releaseDistanceUpdate = resolve;
  });
  await page.route("**/rest/v1/rpc/update_distance", async (route) => {
    await distanceUpdateGate;
    await route.continue();
  });

  let saveAsPresetRequested = false;
  await page.route("**/rest/v1/rpc/save_round_as_preset", async (route) => {
    saveAsPresetRequested = true;
    await route.continue();
  });

  await page.getByTestId("distance-config-toggle-1").click();
  await page.getByTestId("distance-config-unmarked-1").click();
  await page.getByTestId("distance-config-save-1").click();

  await page.getByTestId("save-as-preset-trigger").click();
  await page.getByTestId("save-as-preset-name").fill("直後保存プリセット");
  await page.getByTestId("save-as-preset-confirm").click();

  // 距離の更新が完了するまでは、プリセット保存のリクエストはまだ
  // 送信されていないはず。
  await page.waitForTimeout(500);
  expect(saveAsPresetRequested).toBe(false);

  releaseDistanceUpdate();

  await expect(page.getByTestId("save-as-preset-name")).toBeHidden();
  expect(saveAsPresetRequested).toBe(true);
});

test("サインインが切れた状態でプリセット保存すると、エラーメッセージを表示する", async ({
  page,
}) => {
  const email = `save-as-preset-signout-${Date.now()}@aims.test`;
  const password = "password-save-preset-signout";
  await signUpAndSignIn(page, { email, password });

  const roundId = await createRound({
    email,
    password,
    name: "サインイン切れ保存テスト",
    roundDate: "2026-08-24",
    format: "outdoor",
    bowType: "recurve",
    distances: [{ distance: 30, totalEnds: 3, arrowsPerEnd: 6 }],
  });
  await page.goto(`/rounds/${roundId}`);
  await waitForHydration(page);

  await page.getByTestId("save-as-preset-trigger").click();
  await page
    .getByTestId("save-as-preset-name")
    .fill("サインイン切れプリセット");

  await page.context().clearCookies();
  await page.getByTestId("save-as-preset-confirm").click();

  await expect(page.getByText("サインインが必要です。")).toBeVisible();
  await expect(page.getByTestId("save-as-preset-name")).toBeVisible();
});

import { expect, test } from "./fixtures";
import { SHARED_AUTH_STATE_PATH, signUpAndSignIn } from "./helpers/auth";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test.describe(() => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("初期表示は格納されている", async ({ page }) => {
    await page.goto("/rounds");

    await expect(
      page.getByRole("button", { name: "メニューを開く" }),
    ).toBeVisible();
    // 格納時は-translate-x-fullで画面外へ押し出されるだけで、
    // display:none等にはならないため、toBeHidden()ではなく
    // ビューポート内に無いことで判定する。
    await expect(
      page.getByRole("button", { name: "サインアウト" }),
    ).not.toBeInViewport();
  });

  test("閉じるボタンで格納できる", async ({ page }) => {
    await page.goto("/rounds");
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await expect(
      page.getByRole("button", { name: "サインアウト" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "メニューを閉じる" }).last().click();

    await expect(
      page.getByRole("button", { name: "サインアウト" }),
    ).not.toBeInViewport();
  });

  test("オーバーレイクリックで格納できる", async ({ page }) => {
    await page.goto("/rounds");
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await expect(
      page.getByRole("button", { name: "サインアウト" }),
    ).toBeVisible();

    // オーバーレイはfixed inset-0で画面全体を覆うが、asideの方がz-indexが
    // 高く左側を覆っているため、中央をクリックするとasideに遮られる。
    // aside幅の外側（画面右端寄り）をクリックする。
    await page
      .getByRole("button", { name: "メニューを閉じる" })
      .first()
      .click({ position: { x: 350, y: 300 } });

    await expect(
      page.getByRole("button", { name: "サインアウト" }),
    ).not.toBeInViewport();
  });

  test("モバイルでAIMSリンクをクリックすると/roundsへ遷移する", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await page.getByRole("button", { name: "メニューを開く" }).click();

    await page.getByRole("link", { name: "AIMS" }).click();

    await expect(page).toHaveURL(/\/rounds$/);
  });

  test("モバイルで自分リンクをクリックすると/roundsへ遷移する", async ({
    page,
  }) => {
    await page.goto("/rounds/new");
    await page.getByRole("button", { name: "メニューを開く" }).click();

    await page.getByRole("link", { name: "自分" }).click();

    await expect(page).toHaveURL(/\/rounds$/);
  });

  test("モバイルでサインアウトボタンをクリックすると確認ダイアログが表示される", async ({
    page,
  }) => {
    await page.goto("/rounds");
    await page.getByRole("button", { name: "メニューを開く" }).click();

    await page.getByRole("button", { name: "サインアウト" }).click();

    await expect(
      page.getByRole("button", { name: "サインアウトする" }),
    ).toBeVisible();
  });

  test("格納時はAIMSリンクが無効になる", async ({ page }) => {
    await page.goto("/rounds");
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("button", { name: "メニューを閉じる" }).last().click();

    // 格納時は画面外へ押し出され操作できない。
    await expect(page.getByRole("link", { name: "AIMS" })).not.toBeInViewport();
  });

  test("格納時は自分リンクが無効になる", async ({ page }) => {
    await page.goto("/rounds");
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("button", { name: "メニューを閉じる" }).last().click();

    await expect(page.getByRole("link", { name: "自分" })).not.toBeInViewport();
  });

  test("格納時はサインアウトボタンが無効になる", async ({ page }) => {
    await page.goto("/rounds");
    await page.getByRole("button", { name: "メニューを開く" }).click();
    await page.getByRole("button", { name: "メニューを閉じる" }).last().click();

    await expect(
      page.getByRole("button", { name: "サインアウト" }),
    ).not.toBeInViewport();
  });

  test("ハンバーガーボタンで展開できる", async ({ page }) => {
    await page.goto("/rounds");

    await page.getByRole("button", { name: "メニューを開く" }).click();

    await expect(
      page.getByRole("button", { name: "サインアウト" }),
    ).toBeVisible();
  });
});

test("初期表示は展開されている", async ({ page }) => {
  await page.goto("/rounds");

  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
});

test("格納ボタンでAIMSリンクが無効になる", async ({ page }) => {
  await page.goto("/rounds");

  await page.getByRole("button", { name: "パネルを格納する" }).click();

  await expect(page.getByRole("link", { name: "AIMS" })).toBeHidden();
});

test("格納ボタンで自分リンクが無効になる", async ({ page }) => {
  await page.goto("/rounds");

  await page.getByRole("button", { name: "パネルを格納する" }).click();

  await expect(page.getByRole("link", { name: "自分" })).toBeHidden();
});

test("格納ボタンでサインアウトボタンが無効になる", async ({ page }) => {
  await page.goto("/rounds");

  await page.getByRole("button", { name: "パネルを格納する" }).click();

  await expect(page.getByRole("button", { name: "サインアウト" })).toBeHidden();
});

test("デスクトップでAIMSリンクをクリックすると/roundsへ遷移する", async ({
  page,
}) => {
  await page.goto("/rounds/new");

  await page.getByRole("link", { name: "AIMS" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});

test("デスクトップで自分リンクをクリックすると/roundsへ遷移する", async ({
  page,
}) => {
  await page.goto("/rounds/new");

  await page.getByRole("link", { name: "自分" }).click();

  await expect(page).toHaveURL(/\/rounds$/);
});

test("デスクトップでサインアウトボタンをクリックすると確認ダイアログが表示される", async ({
  page,
}) => {
  await page.goto("/rounds");

  await page.getByRole("button", { name: "サインアウト" }).click();

  await expect(
    page.getByRole("button", { name: "サインアウトする" }),
  ).toBeVisible();
});

test("開くボタンで展開できる", async ({ page }) => {
  await page.goto("/rounds");
  await page.getByRole("button", { name: "パネルを格納する" }).click();
  await expect(page.getByRole("button", { name: "サインアウト" })).toBeHidden();

  await page.getByRole("button", { name: "パネルを開く" }).click();

  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
});

test.describe(() => {
  // サインアウトを試みる（キャンセル・失敗するケースも含む）テストのため、
  // 共有の認証状態を汚さないよう使い捨てユーザーで専用のセッションを使う。
  test.use({ storageState: { cookies: [], origins: [] } });

  test("キャンセルでダイアログを閉じられる", async ({ page }) => {
    const email = `signout-cancel-${Date.now()}@aims.test`;
    await signUpAndSignIn(page, { email, password: "password1" });

    await page.getByRole("button", { name: "サインアウト" }).click();
    await expect(
      page.getByRole("button", { name: "サインアウトする" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "キャンセル" }).click();

    await expect(
      page.getByRole("button", { name: "サインアウトする" }),
    ).not.toBeVisible();
    await expect(page).toHaveURL(/\/rounds/);
  });

  test("背景クリックでダイアログを閉じられる", async ({ page }) => {
    const email = `signout-overlay-${Date.now()}@aims.test`;
    await signUpAndSignIn(page, { email, password: "password1" });

    await page.getByRole("button", { name: "サインアウト" }).click();
    await expect(
      page.getByRole("button", { name: "サインアウトする" }),
    ).toBeVisible();

    await page.mouse.click(10, 10);

    await expect(
      page.getByRole("button", { name: "サインアウトする" }),
    ).not.toBeVisible();
    await expect(page).toHaveURL(/\/rounds/);
  });

  test("送信中は確認ボタンが無効になる", async ({ page }) => {
    const email = `signout-submitting-${Date.now()}@aims.test`;
    await signUpAndSignIn(page, { email, password: "password1" });

    let requestCount = 0;
    let releaseRequest: () => void = () => {};
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/auth/v1/logout*", async (route) => {
      requestCount++;
      await requestGate;
      await route.continue();
    });

    await page.getByRole("button", { name: "サインアウト" }).click();
    const confirmButton = page.getByRole("button", {
      name: "サインアウトする",
    });
    await confirmButton.click();

    await expect(confirmButton).toHaveAttribute("aria-disabled", "true");

    // 無効化が実際にクリックを防いでいることを確認する。
    await confirmButton.click({ force: true });
    expect(requestCount).toBe(1);

    releaseRequest();
    await expect(page).toHaveURL("/");
  });

  test("送信中はキャンセルが無効になる", async ({ page }) => {
    const email = `signout-cancel-submitting-${Date.now()}@aims.test`;
    await signUpAndSignIn(page, { email, password: "password1" });

    let releaseRequest: () => void = () => {};
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/auth/v1/logout*", async (route) => {
      await requestGate;
      await route.continue();
    });

    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.getByRole("button", { name: "サインアウトする" }).click();
    const cancelButton = page.getByRole("button", { name: "キャンセル" });

    await expect(cancelButton).toHaveAttribute("aria-disabled", "true");

    // 無効化が実際にクリックを防いでいることを確認する。
    await cancelButton.click({ force: true });
    await expect(
      page.getByRole("button", { name: "サインアウトする" }),
    ).toBeVisible();

    releaseRequest();
  });

  test("送信中は背景クリックでダイアログを閉じられない", async ({ page }) => {
    const email = `signout-overlay-submitting-${Date.now()}@aims.test`;
    await signUpAndSignIn(page, { email, password: "password1" });

    let releaseRequest: () => void = () => {};
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/auth/v1/logout*", async (route) => {
      await requestGate;
      await route.continue();
    });

    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.getByRole("button", { name: "サインアウトする" }).click();

    await page.mouse.click(10, 10);

    await expect(
      page.getByRole("button", { name: "サインアウトする" }),
    ).toBeVisible();

    releaseRequest();
  });

  test("送信で通信エラーが発生するとメッセージが表示される", async ({
    page,
  }) => {
    const email = `signout-network-error-${Date.now()}@aims.test`;
    await signUpAndSignIn(page, { email, password: "password1" });

    await page.route("**/auth/v1/logout*", (route) => route.abort());

    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.getByRole("button", { name: "サインアウトする" }).click();

    await expect(
      page.getByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/rounds/);
  });

  test("サインアウトすると/へ遷移する", async ({ page }) => {
    const email = `signout-${Date.now()}@aims.test`;
    const password = "password1";
    await signUpAndSignIn(page, { email, password });

    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.getByRole("button", { name: "サインアウトする" }).click();

    await expect(page).toHaveURL("/");
  });
});

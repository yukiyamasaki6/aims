import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH } from "../helpers/auth";

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
  test.use({ viewport: { width: 375, height: 667 } });

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

import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { SHARED_AUTH_STATE_PATH, waitForHydration } from "../helpers/auth";

const MOBILE_VIEWPORT = { width: 375, height: 667 };

async function openRounds(page: Page) {
  await page.goto("/rounds");
  await waitForHydration(page);
}

// モバイルで格納されたレフトパネルは-translate-x-fullで画面外へ押し出されるだけで、
// display:noneにはならないため、非表示ではなくビューポート内に無いことで判定する。
async function expectMobilePanelCollapsed(page: Page) {
  await expect(page.getByRole("link", { name: "AIMS" })).not.toBeInViewport();
  await expect(page.getByRole("link", { name: "個人" })).not.toBeInViewport();
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).not.toBeInViewport();
}

async function expectMobilePanelExpanded(page: Page) {
  await expect(page.getByRole("link", { name: "AIMS" })).toBeInViewport();
  await expect(page.getByRole("link", { name: "個人" })).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeInViewport();
}

async function expectDesktopPanelCollapsed(page: Page) {
  await expect(page.getByRole("link", { name: "AIMS" })).toBeHidden();
  await expect(page.getByRole("link", { name: "個人" })).toBeHidden();
  await expect(page.getByRole("button", { name: "サインアウト" })).toBeHidden();
}

async function expectDesktopPanelExpanded(page: Page) {
  await expect(page.getByRole("link", { name: "AIMS" })).toBeVisible();
  await expect(page.getByRole("link", { name: "個人" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
}

test.describe("紹介画面", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("navigation-01: 任意の画面で未認証のとき、/を開くと、アプリ名と説明文が表示される", async ({
    page,
  }) => {
    // Given: 未認証
    // When: /を開く
    await page.goto("/");

    // Then: アプリ名と説明文が表示される
    await expect(page.getByRole("heading", { name: "AIMS" })).toBeVisible();
    await expect(
      page.getByText("アーチェリーのスコア記録・分析・共有アプリ"),
    ).toBeVisible();
  });

  test("navigation-02: 紹介画面のとき、開始ボタンをクリックすると、/signupへ遷移する", async ({
    page,
  }) => {
    // Given: 紹介画面を開いている
    await page.goto("/");

    // When: 開始ボタンをクリックする
    await page.getByRole("link", { name: "開始" }).click();

    // Then: /signupへ遷移する
    await expect(page).toHaveURL(/\/signup$/);
  });
});

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("navigation-03: /rounds以外の画面でレフトパネルが展開しているとき、AIMSリンクをクリックすると、/roundsへ遷移する", async ({
    page,
  }) => {
    // Given: /rounds/newを開いていて、レフトパネルが展開している
    await page.goto("/rounds/new");
    await waitForHydration(page);

    // When: AIMSリンクをクリックする
    await page.getByRole("link", { name: "AIMS" }).click();

    // Then: /roundsへ遷移する
    await expect(page).toHaveURL(/\/rounds$/);
  });

  test("navigation-05: レフトパネルが展開しているとき、サインアウトボタンをクリックすると、サインアウト確認ダイアログが表示される", async ({
    page,
  }) => {
    // Given: レフトパネルが展開している
    await openRounds(page);
    await expectDesktopPanelExpanded(page);

    // When: サインアウトボタンをクリックする
    await page.getByRole("button", { name: "サインアウト" }).click();

    // Then: サインアウト確認ダイアログが表示される
    await expect(
      page.getByRole("button", { name: "サインアウトする" }),
    ).toBeVisible();
  });

  test.describe("モバイル", () => {
    test.use({ viewport: MOBILE_VIEWPORT });

    test("navigation-06: モバイルのメイン画面のとき、/roundsを開くと、レフトパネルが格納された状態で表示される", async ({
      page,
    }) => {
      // Given: モバイルの画面幅
      // When: /roundsを開く
      await openRounds(page);

      // Then: レフトパネルが格納された状態で表示される
      await expect(
        page.getByRole("button", { name: "メニューを開く" }),
      ).toBeVisible();
      await expectMobilePanelCollapsed(page);
    });

    test("navigation-07: モバイルでレフトパネルが展開しているとき、閉じるボタンをクリックすると、レフトパネルが格納され、中身が見えなくなる", async ({
      page,
    }) => {
      // Given: レフトパネルが展開している
      await openRounds(page);
      await page.getByRole("button", { name: "メニューを開く" }).click();
      await expectMobilePanelExpanded(page);

      // When: 閉じるボタンをクリックする
      await page
        .getByRole("button", { name: "メニューを閉じる" })
        .last()
        .click();

      // Then: レフトパネルが格納され、中身が見えなくなる
      await expectMobilePanelCollapsed(page);
    });

    test("navigation-09: モバイルでレフトパネルが格納されているとき、ハンバーガーボタンをクリックすると、レフトパネルが展開される", async ({
      page,
    }) => {
      // Given: レフトパネルが格納されている
      await openRounds(page);
      await expectMobilePanelCollapsed(page);

      // When: ハンバーガーボタンをクリックする
      await page.getByRole("button", { name: "メニューを開く" }).click();

      // Then: レフトパネルが展開される
      await expectMobilePanelExpanded(page);
    });
  });

  test("navigation-10: デスクトップのメイン画面のとき、/roundsを開くと、レフトパネルが展開された状態で表示される", async ({
    page,
  }) => {
    // Given: デスクトップの画面幅
    // When: /roundsを開く
    await openRounds(page);

    // Then: レフトパネルが展開された状態で表示される
    await expectDesktopPanelExpanded(page);
  });

  test("navigation-11: デスクトップでレフトパネルが展開しているとき、格納ボタンをクリックすると、レフトパネルが格納され、中身が見えなくなる", async ({
    page,
  }) => {
    // Given: レフトパネルが展開している
    await openRounds(page);
    await expectDesktopPanelExpanded(page);

    // When: 格納ボタンをクリックする
    await page.getByRole("button", { name: "パネルを格納する" }).click();

    // Then: レフトパネルが格納され、中身が見えなくなる
    await expectDesktopPanelCollapsed(page);
  });

  test("navigation-12: デスクトップでレフトパネルが格納されているとき、開くボタンをクリックすると、レフトパネルが展開される", async ({
    page,
  }) => {
    // Given: レフトパネルが格納されている
    await openRounds(page);
    await page.getByRole("button", { name: "パネルを格納する" }).click();
    await expectDesktopPanelCollapsed(page);

    // When: 開くボタンをクリックする
    await page.getByRole("button", { name: "パネルを開く" }).click();

    // Then: レフトパネルが展開される
    await expectDesktopPanelExpanded(page);
  });

  test("navigation-13: 任意の画面で認証済みのとき、/を開くと、/roundsへリダイレクトされる", async ({
    page,
  }) => {
    // Given: 認証済み
    // When: /を開く
    await page.goto("/");

    // Then: /roundsへリダイレクトされる
    await expect(page).toHaveURL(/\/rounds$/);
  });
});

test.describe("未認証のガード", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("navigation-14: 任意の画面で未認証のとき、/rounds配下を開くと、/signinへリダイレクトされる", async ({
    page,
  }) => {
    // Given: 未認証
    // When: /rounds配下を開く
    // 代表として/roundsを開く。/rounds/new、/rounds/[id]は単体テスト（session.test.ts）で検証する。
    await page.goto("/rounds");

    // Then: /signinへリダイレクトされる
    await expect(page).toHaveURL(/\/signin$/);
  });
});

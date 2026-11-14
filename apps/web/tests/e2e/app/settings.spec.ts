import { randomUUID } from "node:crypto";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  openSignOutConfirm,
  SHARED_AUTH_STATE_PATH,
  waitForHydration,
} from "../helpers/auth";
import { collectHydrationErrors } from "../helpers/hydration";
import { waitForTurnstileToken } from "../helpers/turnstile";

const authText = translatorFor("auth");
const settingsText = translatorFor("settings");
const navigationText = translatorFor("navigation");
const diagnosticsText = translatorFor("viewportDiagnostics");

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("認証済みで設定のURLを直接開くと、見出しと分類「アカウント」のサインアウトが表示され、再読み込みしても同じ画面が表示される", async ({
    page,
  }) => {
    // 設定のURLを直接開き、見出しと「アカウント」の中のサインアウトが表示される。
    const errors = collectHydrationErrors(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(
      page.getByRole("heading", { name: settingsText("title") }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: settingsText("accountTitle") }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: authText("signOut") }),
    ).toBeVisible();

    // 再読み込みして、同じ画面が表示される。
    await page.reload();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(
      page.getByRole("heading", { name: settingsText("title") }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: authText("signOut") }),
    ).toBeVisible();
    await openSignOutConfirm(page);
    expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
  });

  test("認証済みで設定から表示領域の診断を有効にすると、画面を移ってもバッジが表示され、再読み込み後も保たれ、設定で無効に戻すと消える", async ({
    page,
  }) => {
    // ホームから設定へ移り、診断を有効にしてバッジを表示する。
    const errors = collectHydrationErrors(page);
    const badge = page.getByTestId("viewport-diagnostics-badge");
    const diagnosticsSwitch = page.getByRole("switch", {
      name: diagnosticsText("toggleLabel"),
    });
    const settingsLink = page.getByRole("link", {
      name: navigationText("leftPanelSettings"),
    });
    const homeLink = page.getByRole("link", {
      name: navigationText("leftPanelHome"),
    });
    await page.goto("/rounds");
    await waitForHydration(page);
    await expect(badge).not.toBeVisible();
    await settingsLink.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(diagnosticsSwitch).not.toBeChecked();
    await diagnosticsSwitch.click();
    await expect(badge).toBeVisible();

    // ホームへ移っても、バッジが表示される。
    await homeLink.click();
    await expect(page).toHaveURL(/\/rounds$/);
    await expect(badge).toBeVisible();

    // 再読み込みしても、バッジが表示される。
    await page.reload();
    await waitForHydration(page);
    await expect(badge).toBeVisible();

    // 設定へ移り、診断を無効に戻してバッジを消す。
    await settingsLink.click();
    await expect(diagnosticsSwitch).toBeChecked();
    await diagnosticsSwitch.click();
    await expect(badge).not.toBeVisible();
    expect(errors, "ハイドレーションエラーがないこと").toEqual([]);
  });

  test("設定画面で分類「アカウント」の「パスワード変更」を押すと、パスワード変更の画面へ移動する", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page
      .getByRole("link", { name: settingsText("changePasswordItem") })
      .click();
    await expect(page).toHaveURL(/\/settings\/password$/);
    await expect(
      page.getByRole("heading", { name: authText("changePasswordTitle") }),
    ).toBeVisible();
  });
});

test.describe("未認証", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("未認証で設定を開くと、遷移元に付けてサインイン画面へ移動し、サインインすると設定画面へ戻る", async ({
    page,
  }) => {
    // 設定を開き、設定を遷移元に付けてサインイン画面へ移る。
    const email = `e2e-settings-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`;
    await createConfirmedUser({ email, password: "password1" });
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/signin\?returnTo=%2Fsettings$/);
    await waitForHydration(page);

    // サインインして、設定画面へ戻る。
    await page.getByPlaceholder("you@example.com").fill(email);
    await page
      .getByPlaceholder(authText("passwordPlaceholder"))
      .fill("password1");
    await waitForTurnstileToken(page, 1);
    await page.getByRole("button", { name: authText("signInSubmit") }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(
      page.getByRole("heading", { name: settingsText("title") }),
    ).toBeVisible();
  });
});

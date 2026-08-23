import { expect, test } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

test.use({ storageState: { cookies: [], origins: [] } });

test("未認証で/roundsにアクセスすると/signinにリダイレクトされる", async ({
  page,
}) => {
  await page.goto("/rounds");

  await expect(page).toHaveURL(/\/signin/);
});

test("確認コードでサインインし/roundsにアクセスできる", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "確認コードを送信" }).click();
  await expect(
    page.getByRole("heading", { name: "確認コードを入力" }),
  ).toBeVisible();

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "サインイン" }).click();

  await expect(page).toHaveURL(/\/rounds/);
  await expect(page.getByText(email).first()).toBeVisible();
});

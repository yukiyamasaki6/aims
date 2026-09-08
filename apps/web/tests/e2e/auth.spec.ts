import { expect, test } from "./fixtures";
import { signUpAndSignIn } from "./helpers/auth";

test("未認証で/roundsにアクセスすると/signinにリダイレクトされる", async ({
  page,
}) => {
  await page.goto("/rounds");

  await expect(page).toHaveURL(/\/signin/);
});

test("サインアウトできる", async ({ page }) => {
  const email = `signout-${Date.now()}@aims.test`;
  const password = "password1";
  await signUpAndSignIn(page, { email, password });

  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "サインアウト" }).click();
  await expect(page).toHaveURL("/");
});

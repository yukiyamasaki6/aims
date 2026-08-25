import { expect, test } from "@playwright/test";

test("トップページにアクセスするとサインイン画面が表示される", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "サインイン" })).toBeVisible();
});

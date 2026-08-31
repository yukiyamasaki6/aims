import { expect, test } from "@playwright/test";
import { SHARED_AUTH_STATE_PATH } from "./helpers/auth";

test.use({ storageState: SHARED_AUTH_STATE_PATH });

test("レフトパネルを格納・展開できる", async ({ page }) => {
  await page.goto("/rounds");

  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "パネルを格納する" }).click();
  await expect(page.getByRole("button", { name: "サインアウト" })).toBeHidden();

  await page.getByRole("button", { name: "パネルを開く" }).click();
  await expect(
    page.getByRole("button", { name: "サインアウト" }),
  ).toBeVisible();
});

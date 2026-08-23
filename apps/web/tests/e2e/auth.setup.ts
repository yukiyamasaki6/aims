import path from "node:path";
import { test as setup } from "@playwright/test";
import { getOtpCodeFromMailpit } from "./helpers/mailpit";

const authFile = path.join(__dirname, "../../playwright/.auth/user.json");

setup("authenticate", async ({ page }) => {
  const email = `setup-${Date.now()}@example.com`;

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "確認コードを送信" }).click();
  await page.waitForSelector("text=確認コードを入力");

  const code = await getOtpCodeFromMailpit(email);
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "サインイン" }).click();
  await page.waitForURL(/\/rounds/);

  await page.context().storageState({ path: authFile });
});

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  signInWithEmailOtp,
  waitForHydration,
  waitForOtpSendWindow,
} from "../helpers/auth";
import {
  getEmailFromMailpit,
  getOtpCodeFromMailpit,
  mailIds,
} from "../helpers/mailpit";
import { createRoundWithClient } from "../helpers/rounds";
import { readStoredTokens } from "../helpers/stored-session";
import { waitForTurnstileToken } from "../helpers/turnstile";

const t = translatorFor("auth");
test.use({ storageState: { cookies: [], origins: [] } });
test("新規メールへ届いたコードを確認するとパスワードなしで登録して一覧へ進む", async ({
  page,
}) => {
  // 新規メールを送付してコード入力へ進む。
  const email = `signup-${randomUUID()}@aims.test`;
  const previous = await mailIds(email);
  await page.goto("/signup");
  await waitForHydration(page);
  await page.getByPlaceholder(t("emailPlaceholder")).fill(email);
  await waitForTurnstileToken(page, 1);
  await page.getByRole("button", { name: t("otpSendCode") }).click();
  await expect(
    page.getByRole("heading", { name: t("otpTitle") }),
  ).toBeVisible();

  // 認証リンクのないメールのコードを確認して登録を完了する。
  const message = await getEmailFromMailpit(email, undefined, previous);
  expect(message.html).toContain("15");
  expect(message.html).not.toMatch(/href\s*=|ConfirmationURL|パスワード/i);
  const code = await getOtpCodeFromMailpit(email, previous);
  await page.getByPlaceholder(t("otpCodePlaceholder")).fill(code);
  await page.getByRole("button", { name: t("otpVerify"), exact: true }).click();
  await expect(page).toHaveURL(/\/rounds$/);
});

test("登録済みメールのOTP登録でも同じIDと元の記録と他のセッションを維持する", async ({
  page,
}) => {
  test.setTimeout(150000);
  // 実OTPで元の利用者と記録を準備する。
  const email = `existing-signup-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const first = await signInWithEmailOtp(client, email);
    const originalId = first.data.user?.id;
    expect(first.error === null && originalId !== undefined).toBe(true);
    const name = `登録前の記録-${randomUUID()}`;
    await createRoundWithClient(client, {
      name,
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    });
    await waitForOtpSendWindow(email);
    const previous = await mailIds(email);
    await page.goto("/signup");
    await waitForHydration(page);
    await page.getByPlaceholder(t("emailPlaceholder")).fill(email);
    await waitForTurnstileToken(page, 1);
    await page.getByRole("button", { name: t("otpSendCode") }).click();
    await expect(
      page.getByRole("heading", { name: t("otpTitle") }),
    ).toBeVisible();

    // 登録画面で確認しても元のIDのまま記録へ戻り、別セッションも維持する。
    await page
      .getByPlaceholder(t("otpCodePlaceholder"))
      .fill(await getOtpCodeFromMailpit(email, previous));
    await page
      .getByRole("button", { name: t("otpVerify"), exact: true })
      .click();
    await expect(page).toHaveURL(/\/rounds$/);
    const restored = await readStoredTokens(page.context());
    expect(restored.userId).toBe(originalId);
    await expect(page.getByText(name)).toBeVisible();
    expect((await client.auth.getUser()).data.user?.id).toBe(originalId);
  } finally {
    await client.auth.stopAutoRefresh();
  }
});

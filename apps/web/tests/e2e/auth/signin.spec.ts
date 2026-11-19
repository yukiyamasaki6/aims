import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  signInWithEmailOtp,
  waitForHydration,
} from "../helpers/auth";
import {
  getUserStatus,
  refreshStatus,
  updatePasswordDirect,
} from "../helpers/auth-api";
import {
  getEmailFromMailpit,
  getOtpCodeFromMailpit,
  mailIds,
} from "../helpers/mailpit";
import { authMethodOf, readStoredTokens } from "../helpers/stored-session";
import { waitForTurnstileToken } from "../helpers/turnstile";

const t = translatorFor("auth");
test.use({ storageState: { cookies: [], origins: [] } });
for (const destination of [
  "/rounds",
  "/rounds/new",
  "/rounds#settings/account/email",
]) {
  test(`確認済み利用者がOTPでログインすると${destination}へ進む`, async ({
    page,
  }) => {
    // メールを送付してコード入力へ進む。
    const email = `signin-${randomUUID()}@aims.test`;
    await createConfirmedUser({ email, legacyPassword: "old-password1" });
    const previous = await mailIds(email);
    await page.goto(`/signin?returnTo=${encodeURIComponent(destination)}`);
    await waitForHydration(page);
    await page.getByPlaceholder(t("emailPlaceholder")).fill(email);
    await waitForTurnstileToken(page, 1);
    await page.getByRole("button", { name: t("otpSendCode") }).click();
    await expect(
      page.getByRole("heading", { name: t("otpTitle") }),
    ).toBeVisible();

    // 届いたコードを確認して目的の画面へ進む。
    const code = await getOtpCodeFromMailpit(email, previous);
    await page.getByPlaceholder(t("otpCodePlaceholder")).fill(code);
    await page
      .getByRole("button", { name: t("otpVerify"), exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${destination.replaceAll("/", "\\/")}$`),
    );
    const tokens = await readStoredTokens(page.context());
    expect(authMethodOf(tokens.accessToken)).toBe("otp");

    await expect(
      page.getByRole("heading", { name: t("otpTitle") }),
    ).toHaveCount(0);
  });
}

test("未登録メールもコード入力へ進むが誤コードで保護画面へ入れない", async ({
  page,
}) => {
  // 未登録メールを送付し共通のコード入力へ進む。
  await page.goto("/signin");
  await waitForHydration(page);
  await page
    .getByPlaceholder(t("emailPlaceholder"))
    .fill(`unknown-${randomUUID()}@aims.test`);
  await waitForTurnstileToken(page, 1);
  await page.getByRole("button", { name: t("otpSendCode") }).click();
  await expect(
    page.getByRole("heading", { name: t("otpTitle") }),
  ).toBeVisible();

  // 誤コードを確認すると理由を表示し同じ画面に留まる。
  await page.getByPlaceholder(t("otpCodePlaceholder")).fill("000000");
  await page.getByRole("button", { name: t("otpVerify"), exact: true }).click();
  await expect(page.getByText(t("failure.code_expired"))).toBeVisible();
  await expect(page).toHaveURL(/\/signin$/);
});

test("直接のパスワードgrantは正しい旧パスワードでもトークンを発行しない", async () => {
  const email = `password-denied-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email, legacyPassword: "old-password1" });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password: "old-password1",
      options: { captchaToken: "test-captcha-token" },
    });
    expect(error !== null).toBe(true);
    expect(data.session === null).toBe(true);
    const { error: denied } = await client.from("rounds").select("id");
    expect(denied !== null).toBe(true);
  } finally {
    await client.auth.stopAutoRefresh();
  }
});

test("OTP後に直接パスワードを更新しても新しいパスワード認証は復活しない", async () => {
  const email = `updated-password-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email, legacyPassword: "old-password1" });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const { data, error } = await signInWithEmailOtp(client, email);
    expect(error === null && data.session !== null).toBe(true);
    const updated = await updatePasswordDirect(
      data.session?.access_token ?? "",
      { password: "updated-password1" },
    );
    expect(updated.status).toBe(200);
    expect((await getUserStatus(data.session?.access_token ?? "")).status).toBe(
      200,
    );
    expect(
      (await refreshStatus(data.session?.refresh_token ?? "")).status,
    ).toBe(200);
    await client.auth.signOut({ scope: "local" });
    const attempt = await client.auth.signInWithPassword({
      email,
      password: "updated-password1",
      options: { captchaToken: "test-captcha-token" },
    });
    expect(attempt.error !== null && attempt.data.session === null).toBe(true);
  } finally {
    await client.auth.stopAutoRefresh();
  }
});

test("直接password signupを要求してもパスワードのセッションを発行できない", async () => {
  const email = `direct-signup-${randomUUID()}@aims.test`;
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const registered = await client.auth.signUp({
      email,
      password: "old-password1",
      options: { captchaToken: "test-captcha-token" },
    });
    expect(registered.data.session === null).toBe(true);
    const attempt = await client.auth.signInWithPassword({
      email,
      password: "old-password1",
      options: { captchaToken: "test-captcha-token" },
    });
    expect(attempt.data.session === null && attempt.error !== null).toBe(true);
    expect((await client.from("rounds").select("id")).error !== null).toBe(
      true,
    );
  } finally {
    await client.auth.stopAutoRefresh();
  }
});

test("直接回復要求のメールはコードだけで、回復コードの確認後に直接パスワードを更新してもそのパスワードでは認証できない", async () => {
  const email = `recovery-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email, legacyPassword: "old-password1" });
  const previous = await mailIds(email);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    options,
  );
  const probe = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    options,
  );
  try {
    const sent = await client.auth.resetPasswordForEmail(email, {
      captchaToken: "test-captcha-token",
    });
    expect(sent.error === null).toBe(true);
    const message = await getEmailFromMailpit(email, undefined, previous);
    expect(message.html).not.toMatch(/href\s*=|ConfirmationURL|パスワード/i);

    // 回復コードの確認は実Authが方式otpとして発行し、通常のメールOTPと同等に扱う。
    const token = await getOtpCodeFromMailpit(email, previous);
    const verified = await client.auth.verifyOtp({
      email,
      token,
      type: "recovery",
    });
    const issued = verified.data.session;
    expect(issued ? authMethodOf(issued.access_token) : null).toBe("otp");

    // 更新API自体の成否は問わず、更新したパスワードでの認証が成立しないことを確かめる。
    await client.auth.updateUser({ password: "recovered-password1" });
    const passwordAttempt = await probe.auth.signInWithPassword({
      email,
      password: "recovered-password1",
      options: { captchaToken: "test-captcha-token" },
    });
    expect(
      passwordAttempt.data.session === null && passwordAttempt.error !== null,
    ).toBe(true);
    expect((await probe.from("rounds").select("id")).error !== null).toBe(true);
  } finally {
    await Promise.all([
      client.auth.stopAutoRefresh(),
      probe.auth.stopAutoRefresh(),
    ]);
  }
});

test("使用済みの実OTPを別のクライアントで再使用しても保護データを読めない", async () => {
  const email = `reused-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email });
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    options,
  );
  const other = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    options,
  );
  try {
    const first = await signInWithEmailOtp(client, email);
    expect(first.data.session !== null && first.error === null).toBe(true);
    const token = await getOtpCodeFromMailpit(email);
    const reused = await other.auth.verifyOtp({ email, token, type: "email" });
    expect(reused.data.session === null && reused.error !== null).toBe(true);
    expect((await other.from("rounds").select("id")).error !== null).toBe(true);
  } finally {
    await Promise.all([
      client.auth.stopAutoRefresh(),
      other.auth.stopAutoRefresh(),
    ]);
  }
});

test("送付されたコードのメールを読むだけでは認証されず、送付した端末でコードを確認した後だけ保護データを読める", async () => {
  const email = `mail-read-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email });
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const sender = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    options,
  );
  const reader = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    options,
  );
  try {
    const previous = await mailIds(email);
    const sent = await sender.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, captchaToken: "test-captcha-token" },
    });
    expect(sent.error === null).toBe(true);
    const token = await getOtpCodeFromMailpit(email, previous);
    const sessions = await Promise.all([
      sender.auth.getSession(),
      reader.auth.getSession(),
    ]);
    expect(sessions.map(({ data }) => data.session)).toEqual([null, null]);
    expect((await sender.from("rounds").select("id")).error !== null).toBe(
      true,
    );
    expect((await reader.from("rounds").select("id")).error !== null).toBe(
      true,
    );
    const verified = await sender.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    expect(verified.error === null && verified.data.session !== null).toBe(
      true,
    );
    expect((await sender.from("rounds").select("id")).error === null).toBe(
      true,
    );
    expect((await reader.auth.getSession()).data.session).toBeNull();
  } finally {
    await Promise.all([
      sender.auth.stopAutoRefresh(),
      reader.auth.stopAutoRefresh(),
    ]);
  }
});

test("ログインのメール本文は「認証コード」の件名と6桁のコードと「15分」の期限と「心当たりがない場合」の案内を持ち、リンクを持たない", async () => {
  const email = `mail-body-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const previous = await mailIds(email);
    const sent = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, captchaToken: "test-captcha-token" },
    });
    expect(sent.error === null).toBe(true);
    const message = await getEmailFromMailpit(email, undefined, previous);
    expect(message.subject).toContain("認証コード");
    expect(message.html).toMatch(/>\s*\d{6}\s*</);
    expect(message.html).toContain("15分");
    expect(message.html).toContain("心当たりがない場合");
    expect(message.html).not.toMatch(/href\s*=|ConfirmationURL|パスワード/i);
  } finally {
    await client.auth.stopAutoRefresh();
  }
});

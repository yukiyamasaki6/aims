import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  emailOfUser,
  SHARED_AUTH_STATE_PATH,
  signInWithEmailOtp,
  waitForHydration,
  waitForOtpSendWindow,
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
import { createRoundWithClient } from "../helpers/rounds";
import { authMethodOf, readStoredTokens } from "../helpers/stored-session";
import { waitForTurnstileToken } from "../helpers/turnstile";

const t = translatorFor("auth");
const introductionText = translatorFor("introduction");
const sharedText = translatorFor("shared");
test.use({ storageState: { cookies: [], origins: [] } });

function anonymousClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
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
    await page.getByRole("button", { name: t("emailContinue") }).click();
    await expect(page.getByPlaceholder(t("otpCodePlaceholder"))).toBeVisible();

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
  });
}

test("未登録メールへ届いたコードを確認すると、パスワードなしで登録されて一覧へ進み、ローカルDBに利用者が作られる", async ({
  page,
}) => {
  // 新規メールを送付してコード入力へ進む。
  const email = `signup-${randomUUID()}@aims.test`;
  const previous = await mailIds(email);
  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByPlaceholder(t("emailPlaceholder")).fill(email);
  await waitForTurnstileToken(page, 1);
  await page.getByRole("button", { name: t("emailContinue") }).click();
  await expect(page.getByPlaceholder(t("otpCodePlaceholder"))).toBeVisible();

  // 認証リンクのないメールのコードを確認して登録を完了する。
  const message = await getEmailFromMailpit(email, undefined, previous);
  expect(message.html).toContain("15");
  expect(message.html).not.toMatch(/href\s*=|ConfirmationURL|パスワード/i);
  const code = await getOtpCodeFromMailpit(email, previous);
  await page.getByPlaceholder(t("otpCodePlaceholder")).fill(code);
  await page.getByRole("button", { name: t("otpVerify"), exact: true }).click();
  await expect(page).toHaveURL(/\/rounds$/);
  const tokens = await readStoredTokens(page.context());
  expect(await emailOfUser(tokens.userId)).toBe(email);
});

test("未登録メールで保護画面の設定項目から認証すると、確認後に同じ画面と設定項目へ戻る", async ({
  page,
}) => {
  // 設定項目を指す遷移元付きのサインインで、新規メールを送付する。
  const email = `signup-return-${randomUUID()}@aims.test`;
  const previous = await mailIds(email);
  await page.goto(
    `/signin?returnTo=${encodeURIComponent("/rounds/new#settings/account/email")}`,
  );
  await waitForHydration(page);
  await page.getByPlaceholder(t("emailPlaceholder")).fill(email);
  await waitForTurnstileToken(page, 1);
  await page.getByRole("button", { name: t("emailContinue") }).click();
  await expect(page.getByPlaceholder(t("otpCodePlaceholder"))).toBeVisible();

  // 届いたコードを確認して、遷移元へ進む。
  await page
    .getByPlaceholder(t("otpCodePlaceholder"))
    .fill(await getOtpCodeFromMailpit(email, previous));
  await page.getByRole("button", { name: t("otpVerify"), exact: true }).click();
  await expect(page).toHaveURL(/\/rounds\/new#settings\/account\/email$/);
});

test("登録済みメールで確認しても、同じ利用者IDと元の記録と他のセッションを維持する", async ({
  page,
}) => {
  test.setTimeout(150000);
  // 実OTPで元の利用者と記録を準備する。
  const email = `existing-signin-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email });
  const client = anonymousClient();
  try {
    const first = await signInWithEmailOtp(client, email);
    const originalId = first.data.user?.id;
    expect(first.error).toBeNull();
    expect(originalId).toBeDefined();
    const name = `登録前の記録-${randomUUID()}`;
    await createRoundWithClient(client, {
      name,
      roundDate: "2026-08-24",
      distances: [{ distance: 18, totalEnds: 12, arrowsPerEnd: 3 }],
    });

    // 同じメールを送付してコード入力へ進む。
    await waitForOtpSendWindow(email);
    const previous = await mailIds(email);
    await page.goto("/signin");
    await waitForHydration(page);
    await page.getByPlaceholder(t("emailPlaceholder")).fill(email);
    await waitForTurnstileToken(page, 1);
    await page.getByRole("button", { name: t("emailContinue") }).click();
    await expect(page.getByPlaceholder(t("otpCodePlaceholder"))).toBeVisible();

    // 確認しても元のIDのまま記録へ戻り、別セッションも維持する。
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

for (const registered of [false, true]) {
  test(`登録${registered ? "済み" : "前"}のメールを送付しても、登録有無を示さず同じ案内のコード入力へ進む`, async ({
    page,
  }) => {
    // メールを送ってコード入力へ進む。
    const email = `same-screen-${registered}-${randomUUID()}@aims.test`;
    if (registered) await createConfirmedUser({ email });
    await page.goto("/signin");
    await waitForHydration(page);
    await page.getByPlaceholder(t("emailPlaceholder")).fill(email);
    await waitForTurnstileToken(page, 1);
    await page.getByRole("button", { name: t("emailContinue") }).click();

    // 共通の案内だけが表示され、登録の有無による見出しや失敗は現れない。
    await expect(page.getByText(t("otpDescription", { email }))).toBeVisible();
    await expect(page.getByText(t("otpSpamNote"))).toBeVisible();
    await expect(page.getByRole("heading")).toHaveCount(0);
  });
}

test.describe("認証済み", () => {
  test.use({ storageState: SHARED_AUTH_STATE_PATH });

  test("遷移元のない/signinを開くと、ホームへ移動する", async ({ page }) => {
    await page.goto("/signin");

    await expect(page).toHaveURL(/\/rounds$/);
  });

  test("有効な遷移元付きの/signinを開くと、その遷移元へ移動する", async ({
    page,
  }) => {
    await page.goto(
      `/signin?returnTo=${encodeURIComponent("/rounds/new#settings/account")}`,
    );

    await expect(page).toHaveURL(/\/rounds\/new#settings\/account$/);
  });
});

test("サインイン画面でAIMSロゴを押すと、紹介画面へ移動する", async ({
  page,
}) => {
  await page.goto("/signin");
  await waitForHydration(page);

  await page.getByRole("link", { name: sharedText("logoAlt") }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: introductionText("catch") }),
  ).toBeVisible();
});

test("未登録メールもコード入力へ進むが誤コードで保護画面へ入れず、同じ画面に留まる", async ({
  page,
}) => {
  // 未登録メールを送付し共通のコード入力へ進む。
  await page.goto("/signin");
  await waitForHydration(page);
  await page
    .getByPlaceholder(t("emailPlaceholder"))
    .fill(`unknown-${randomUUID()}@aims.test`);
  await waitForTurnstileToken(page, 1);
  await page.getByRole("button", { name: t("emailContinue") }).click();
  await expect(page.getByPlaceholder(t("otpCodePlaceholder"))).toBeVisible();

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

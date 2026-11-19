import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  markOtpSent,
  signInWithEmailOtp,
  signUpAndSignIn,
  waitForOtpSendWindow,
} from "../helpers/auth";
import { getOtpCodeFromMailpit, mailIds } from "../helpers/mailpit";
import { signInOnOtherDevice } from "../helpers/other-browser-device";
import { addRound, signInFreshUser } from "../helpers/round-fixtures";
import { settingsPanel } from "../helpers/settings";

const t = translatorFor("auth");
const settings = translatorFor("settings");
const rounds = translatorFor("rounds");
const navigation = translatorFor("navigation");
// supabase/config.tomlのjwt_expiry（3600秒）を越える時間。
const PAST_JWT_EXPIRY_MS = 3_600_000 + 60_000;
test.use({ storageState: { cookies: [], origins: [] } });

// 「アカウントを削除」を押し、送信ボタンを挟まずに届く新しいコードを確認して削除し、遷移元なしのサインインへ移ったことの確認で終わる。
async function deleteWithNewCode(page: Page, email: string) {
  // 実Authは同じ宛先への送信を60秒空けるため、直前のログインのコード送信から間隔を空ける。
  await waitForOtpSendWindow(email);
  const previous = await mailIds(email);
  await page.getByRole("button", { name: t("deleteAccountSubmit") }).click();
  await expect(
    page.getByRole("heading", { name: t("otpTitle") }),
  ).toBeVisible();
  markOtpSent(email);
  // コードを確認するまでは削除されず、設定パネルに留まる。
  await expect(page).toHaveURL(/#settings\/account\/delete-account$/);
  await page
    .getByPlaceholder(t("otpCodePlaceholder"))
    .fill(await getOtpCodeFromMailpit(email, previous));
  await page.getByRole("button", { name: t("deleteAccountVerify") }).click();
  await expect(page).toHaveURL(/\/signin$/);
}
test("OTPでログインした利用者が設定から削除を選び、現在メールへ届く新しいコードを確認すると削除されてサインインへ移り、再登録しても旧記録を表示しない", async ({
  page,
}) => {
  test.setTimeout(240000);
  // 記録のある利用者で削除画面へ進む。
  const credentials = await signInFreshUser(page, "delete-otp");
  const name = `削除前-${randomUUID()}`;
  await addRound(credentials, name, "2026-08-24", { completed: true });
  await page.goto("/rounds/history");
  await expect(page.getByText(name)).toBeVisible();
  await page
    .getByRole("link", { name: navigation("leftPanelSettings"), exact: true })
    .click();
  await settingsPanel(page)
    .getByRole("link", { name: settings("deleteAccountItem") })
    .click();
  await expect(
    settingsPanel(page).getByRole("heading", { name: t("deleteAccountTitle") }),
  ).toBeVisible();
  await expect(
    settingsPanel(page).locator('[data-hydrated="true"]'),
  ).toBeAttached();

  await deleteWithNewCode(page, credentials.email);

  // 同じメールで再登録し履歴に旧記録がないことを確認する。
  await signUpAndSignIn(page, credentials);
  await page.goto("/rounds/history");
  await expect(page.getByText(rounds("historyEmpty"))).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
});

test("実AuthのOTPで署名されたJWTは本人の削除を許し改ざんJWTと別人IDを拒否する", async () => {
  const email = `delete-api-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email, password: "old-password1" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const verified = await signInWithEmailOtp(client, email);
    expect(verified.error === null && verified.data.session !== null).toBe(
      true,
    );
    const token = verified.data.session?.access_token ?? "";
    const userId = verified.data.user?.id ?? "";
    const rpc = async (accessToken: string, expected: string) =>
      fetch(`${url}/rest/v1/rpc/delete_account`, {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ expected_user_id: expected }),
      });
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    payload.sub = randomUUID();
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect((await rpc(parts.join("."), userId)).status).toBe(401);
    const wrong = await rpc(token, randomUUID());
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).message).toBe("account_deletion_forbidden");
    expect((await client.auth.getUser()).data.user?.id).toBe(userId);
    expect((await rpc(token, userId)).status).toBe(204);
  } finally {
    await client.auth.stopAutoRefresh();
  }
});

test("古いOTPのJWTは更新しても新しいコードの送付だけでも削除できず、再確認した新しいセッションだけが削除できる", async () => {
  test.setTimeout(180000);
  const email = `delete-stale-${randomUUID()}@aims.test`;
  await createConfirmedUser({ email });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const stale = createClient(url, key, options);
  const recent = createClient(url, key, options);
  const rpc = async (accessToken: string, expected: string) => {
    const response = await fetch(`${url}/rest/v1/rpc/delete_account`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expected_user_id: expected }),
    });
    return {
      status: response.status,
      message: response.ok ? null : (await response.json()).message,
    };
  };
  const otpRequired = { status: 403, message: "otp_confirmation_required" };
  try {
    const first = await signInWithEmailOtp(stale, email);
    const verifiedAt = Date.now();
    const userId = first.data.user?.id ?? "";
    const firstToken = first.data.session?.access_token ?? "";
    expect(first.error === null && firstToken !== "").toBe(true);
    // サーバーの認可にはテスト側の時計を使えないため、実際の60秒経過を待つ。
    await expect
      .poll(() => Date.now() - verifiedAt > 61000, {
        timeout: 65000,
        intervals: [1000],
        message: "AuthのOTP証跡が60秒を超える",
      })
      .toBe(true);
    expect(await rpc(firstToken, userId)).toEqual(otpRequired);
    const refreshed = await stale.auth.refreshSession();
    const refreshedToken = refreshed.data.session?.access_token ?? "";
    expect(refreshed.error === null && refreshedToken !== firstToken).toBe(
      true,
    );
    expect(await rpc(refreshedToken, userId)).toEqual(otpRequired);

    // 新しいコードは送付されただけでは、どのセッションの証跡も更新しない。
    await waitForOtpSendWindow(email);
    const previous = await mailIds(email);
    const sent = await recent.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, captchaToken: "test-captcha-token" },
    });
    expect(sent.error === null).toBe(true);
    markOtpSent(email);
    const token = await getOtpCodeFromMailpit(email, previous);
    expect(await rpc(refreshedToken, userId)).toEqual(otpRequired);

    // 再確認で得た新しいセッションだけが新しい証跡を持ち、古いJWTには引き継がれない。
    const second = await recent.auth.verifyOtp({ email, token, type: "email" });
    const secondToken = second.data.session?.access_token ?? "";
    expect(second.error === null && secondToken !== "").toBe(true);
    expect(await rpc(refreshedToken, userId)).toEqual(otpRequired);
    expect(await rpc(secondToken, userId)).toEqual({
      status: 204,
      message: null,
    });
  } finally {
    await Promise.all([
      stale.auth.stopAutoRefresh(),
      recent.auth.stopAutoRefresh(),
    ]);
  }
});

test("別の端末でもサインインしている利用者がこの端末で削除すると、別の端末はアクセストークンの期限後にセッションを更新できずサインイン画面へ移動する", async ({
  page,
  browser,
}) => {
  test.setTimeout(300000);
  // 別の端末でサインインして一覧を開く。
  const credentials = {
    email: `delete-other-device-${randomUUID()}@aims.test`,
    password: "unused",
  };
  const other = await signInOnOtherDevice(browser, credentials);
  try {
    // この端末でサインインし、削除画面へ進む。
    await signUpAndSignIn(page, credentials);
    await page.goto("/rounds#settings/account/delete-account");
    await expect(
      settingsPanel(page).getByRole("heading", {
        name: t("deleteAccountTitle"),
      }),
    ).toBeVisible();
    await expect(
      settingsPanel(page).locator('[data-hydrated="true"]'),
    ).toBeAttached();

    await deleteWithNewCode(page, credentials.email);

    // 別の端末は期限後の更新を拒否され、サインイン画面へ移る。
    const refresh = other.page.waitForResponse(
      (response) =>
        response.url().includes("/auth/v1/token") &&
        response.url().includes("grant_type=refresh_token"),
    );
    await other.page.clock.fastForward(PAST_JWT_EXPIRY_MS);
    expect((await refresh).ok()).toBe(false);
    await expect(other.page).toHaveURL(/\/signin/);
  } finally {
    await other.context.close();
  }
});

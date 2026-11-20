import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  signInWithEmailOtp,
  signUpAndSignIn,
} from "../helpers/auth";
import { backdateOtpEvidence, resetOtpSendInterval } from "../helpers/auth-db";
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

// 「アカウントを削除」を押し、別の送信ボタンを挟まずに届く新しいコードを確認して削除し、遷移元なしのサインインへ移ったことの確認で終わる。
async function deleteWithNewCode(page: Page, email: string) {
  // 実Authの送信間隔は、送信時刻の記録を戻して、直前のログインのコード送信から60秒が経過した状態にする。
  await resetOtpSendInterval(email);
  const previous = await mailIds(email);
  await page.getByRole("button", { name: t("deleteAccountSubmit") }).click();
  await expect(page.getByPlaceholder(t("otpCodePlaceholder"))).toBeVisible();
  // コードを確認するまでは削除されず、設定パネルに留まる。
  await expect(page).toHaveURL(/#settings\/account\/delete-account$/);
  await page
    .getByPlaceholder(t("otpCodePlaceholder"))
    .fill(await getOtpCodeFromMailpit(email, previous));
  await page.getByRole("button", { name: t("deleteAccountVerify") }).click();
  await expect(page).toHaveURL(/\/signin$/);
}
test("OTPでログインした直後の利用者が設定から削除を選ぶと送信間隔の案内で留まり、間隔の後に押し直して現在メールへ届く新しいコードを確認すると削除されてサインインへ移り、再登録しても旧記録を表示しない", async ({
  page,
}) => {
  // 実物のチェックは、送信のたびのやり直しで新しい結果を渡す。モックにも同じ取り直しをさせる。
  await page.addInitScript(() => {
    Object.assign(window, { e2eTurnstileReissueOnReset: true });
  });
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

  // ログインの直後に削除を押すと、実Authの送信間隔でコードの送付が拒否され、削除されずに同じ画面へ理由が表示される。
  await page.getByRole("button", { name: t("deleteAccountSubmit") }).click();
  await expect(page.getByText(t("failure.rate_limited"))).toBeVisible();
  await expect(
    page.getByRole("button", { name: t("deleteAccountSubmit") }),
  ).toBeVisible();

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
    const userId = first.data.user?.id ?? "";
    const firstToken = first.data.session?.access_token ?? "";
    expect(first.error === null && firstToken !== "").toBe(true);
    // サーバーの認可はテスト側の時計を使えないため、セッションのOTPの記録を2分戻してから更新し、60秒を超えて古い証跡のJWTを得る。
    // 実際に60秒が経過することは確かめない。
    await backdateOtpEvidence(email);
    const refreshed = await stale.auth.refreshSession();
    const refreshedToken = refreshed.data.session?.access_token ?? "";
    expect(refreshed.error === null && refreshedToken !== firstToken).toBe(
      true,
    );
    expect(await rpc(refreshedToken, userId)).toEqual(otpRequired);

    // 新しいコードは送付されただけでは、どのセッションの証跡も更新しない。
    await resetOtpSendInterval(email);
    const previous = await mailIds(email);
    const sent = await recent.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, captchaToken: "test-captcha-token" },
    });
    expect(sent.error === null).toBe(true);
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

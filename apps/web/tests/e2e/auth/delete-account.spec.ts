import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { DELETE_ACCOUNT_HASH, ROUNDS_PATH } from "@/routes";
import { expect, test } from "../fixtures";
import {
  createConfirmedUser,
  signUpAndSignIn,
  waitForHydration,
} from "../helpers/auth";
import { signInError } from "../helpers/auth-api";
import { getOtpCodeFromMailpit } from "../helpers/mailpit";
import { addRound, signInFreshUser } from "../helpers/round-fixtures";
import { signInAsTestUser } from "../helpers/rounds";
import {
  comeBackOnline,
  goOffline,
  waitForServiceWorkerControl,
} from "../helpers/service-worker";
import { settingsPanel, waitForPanelHydration } from "../helpers/settings";
import { authMethodOf } from "../helpers/stored-session";
import { waitForTurnstileToken } from "../helpers/turnstile";

// 削除は破壊的で、他のspecとデータを共有しないため、共有の認証状態は使わず、使い捨てのユーザーを作る。
// 独立した使い捨てのスタックでだけ実行する(共有のスタックでは実行しない)。
test.use({ storageState: { cookies: [], origins: [] } });

const authText = translatorFor("auth");
const settingsText = translatorFor("settings");
const navigationText = translatorFor("navigation");
const roundsText = translatorFor("rounds");

function passwordInput(page: Page) {
  return page.getByPlaceholder(authText("deleteAccountPasswordPlaceholder"));
}

function deleteButton(page: Page) {
  return page.getByRole("button", { name: authText("deleteAccountSubmit") });
}

function newEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@aims.test`;
}

test("ラウンドを持つ利用者が、設定から現在のパスワードで削除すると、サインイン画面へ移り、削除したメールアドレスでは入れず、同じメールアドレスで新しく登録した利用者には旧ラウンドが表示されない", async ({
  page,
}) => {
  // ラウンドを持つ使い捨ての利用者でサインインし、設定パネルからアカウント削除の画面へ進む。
  const credentials = await signInFreshUser(page, "e2e-delete-account");
  const roundName = `削除前のラウンド-${randomUUID().slice(0, 8)}`;
  await addRound(credentials, roundName, "2026-08-24", { completed: true });
  await page.goto("/rounds/history");
  await expect(page.getByText(roundName)).toBeVisible();
  await page
    .getByRole("link", {
      name: navigationText("leftPanelSettings"),
      exact: true,
    })
    .click();
  await settingsPanel(page)
    .getByRole("link", { name: settingsText("deleteAccountItem") })
    .click();
  await expect(
    settingsPanel(page).getByRole("heading", {
      name: authText("deleteAccountTitle"),
    }),
  ).toBeVisible();
  await waitForHydration(page);

  // 現在のパスワードを入力して削除を実行し、遷移元の無いサインイン画面へ移る。
  await passwordInput(page).fill(credentials.password);
  await waitForTurnstileToken(page, 1);
  await deleteButton(page).click();
  await expect(page).toHaveURL(/\/signin$/);

  // 削除したメールアドレスでは認証サービスにサインインを拒まれ、保護された画面はサインインへ移る。
  expect(await signInError(credentials.email, credentials.password)).toBe(
    "invalid_credentials",
  );
  await page.goto("/rounds");
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Frounds$/);

  // 同じメールアドレスで新しく登録してサインインすると、履歴に旧ラウンドは表示されない。
  await signUpAndSignIn(page, credentials);
  await page.goto("/rounds/history");
  await expect(page.getByText(roundsText("historyEmpty"))).toBeVisible();
  await expect(page.getByText(roundName)).toHaveCount(0);
});

test("認証コードで入ったセッションのアクセストークンでアカウント削除のRPCをREST越しに直接呼ぶと拒否され、その後も同じアカウントでパスワードでサインインでき、記録が残る", async () => {
  // パスワードを持つ利用者とラウンドを作り、パスワード再設定のメールの認証コードを確認して、認証コード由来のセッションを得る。
  const credentials = {
    email: newEmail("e2e-delete-otp"),
    password: "password-e2e-delete-otp",
  };
  await createConfirmedUser(credentials);
  const roundId = await addRound(credentials, "残るラウンド", "2026-08-24");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const sent = await client.auth.resetPasswordForEmail(credentials.email, {
    captchaToken: "test-captcha-token",
  });
  expect(sent.error).toBeNull();
  const { data } = await client.auth.verifyOtp({
    email: credentials.email,
    token: await getOtpCodeFromMailpit(credentials.email),
    type: "recovery",
  });
  const accessToken = data.session?.access_token ?? "";
  expect(authMethodOf(accessToken)).toBe("otp");

  // そのアクセストークンでRPCを直接呼ぶと、再認証が必要としてPT403で拒否され、アカウントはパスワードでサインインでき、ラウンドが残る。
  const response = await fetch(`${url}/rest/v1/rpc/delete_account`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("PT403");
  expect(await signInError(credentials.email, credentials.password)).toBeNull();
  const { supabase } = await signInAsTestUser(
    credentials.email,
    credentials.password,
  );
  const { data: rounds } = await supabase
    .from("rounds")
    .select("id")
    .eq("id", roundId);
  expect(rounds).toHaveLength(1);
});

test("画面の枠を保存した後、オフラインでアカウント削除の画面を開いて削除を実行すると、オフラインの文言が表示され、アカウントは残り、通信が戻ると再び実行できる", async ({
  page,
  context,
}) => {
  // 使い捨ての利用者でサインインし、ラウンド一覧を開いて、Service Workerが枠を保存するのを待つ。
  const credentials = await signInFreshUser(page, "e2e-delete-offline");
  await page.goto(ROUNDS_PATH);
  await waitForHydration(page);
  await waitForServiceWorkerControl(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const urls: string[] = [];
        for (const name of await caches.keys()) {
          if (!name.startsWith("serwist-precache")) continue;
          for (const request of await (await caches.open(name)).keys()) {
            urls.push(request.url);
          }
        }
        return urls.some((url) => url.includes("/__shell/rounds?"));
      }),
    )
    .toBe(true);

  // オフラインにして削除の画面を開き、パスワードを入力して削除を実行すると、オフラインの文言が表示される。
  // 同じ文書内の移動にならないよう、別の画面を開いてから、オフラインにする。
  await page.goto("/rounds/new");
  await goOffline(context);
  const response = await page.goto(`${ROUNDS_PATH}${DELETE_ACCOUNT_HASH}`);
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(settingsPanel(page)).toBeVisible();
  await waitForPanelHydration(page);
  await passwordInput(page).fill(credentials.password);
  await waitForTurnstileToken(page, 1);
  await deleteButton(page).click();
  await expect(page.getByText(authText("failure.offline"))).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${DELETE_ACCOUNT_HASH}$`));

  // 通信が戻ると、アカウントは残っていて、削除を再び押せる。
  await comeBackOnline(context, page);
  expect(await signInError(credentials.email, credentials.password)).toBeNull();
  await expect(deleteButton(page)).toHaveAttribute("aria-disabled", "false");
});

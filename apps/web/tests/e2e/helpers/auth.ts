import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { resetOtpSendInterval } from "./auth-db";
import { getOtpCodeFromMailpit, mailIds } from "./mailpit";
import { readStoredTokens } from "./stored-session";
import { waitForTurnstileToken } from "./turnstile";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");
const settingsText = translatorFor("settings");

export const SHARED_AUTH_STATE_PATH = "playwright/.auth/e2e-shared-user.json";
const SHARED_EMAIL_PATH = "playwright/.auth/e2e-shared-email.txt";
export const SHARED_PASSWORD = "password-e2e-shared";

// ハイドレーション完了前にクリック・入力すると、ハンドラ未接続で空振り
// したり、直後の再描画で入力値が消えたりすることがある（e2eで確認済み）。
// ハードナビゲーション（page.goto）直後に操作する前に、各画面のクライアント
// コンポーネントが立てるdata-hydrated属性を待つ。
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached();
}

// テストは毎回同じ初期状態から始まるべきという原則を、DBリセットに頼らず
// 保証する。rounds/preset_roundsはユーザー単位でRLS・owner_idにより
// 可視性が絞られるため、実行のたびに使い捨ての新しいメールアドレスに
// することで、過去の実行で作成したラウンドやプリセットがこのユーザーには
// 一切見えない＝一覧が必ず空から始まる状態を実現できる（データを消す
// 必要がない）。workerは複数プロセスに分かれるため、モジュール内で直接
// Date.now()するとプロセスごとに値がずれてしまう。auth.setup.ts（setup
// プロジェクト）だけが値を生成してファイルに書き出し、他のテストは
// （setupプロジェクトへの依存により必ず書き込み後に実行される）テスト
// 本体の中でこのファイルを読む。
export function saveSharedEmail(email: string): void {
  mkdirSync(dirname(SHARED_EMAIL_PATH), { recursive: true });
  writeFileSync(SHARED_EMAIL_PATH, email, "utf-8");
}

let isolatedEmail: { testId: string; email: string } | undefined;
export function setIsolatedEmail(email: string) {
  isolatedEmail = { testId: test.info().testId, email };
}
export function getSharedEmail(): string {
  if (isolatedEmail?.testId === test.info().testId) return isolatedEmail.email;
  if (!existsSync(SHARED_EMAIL_PATH)) {
    throw new Error(
      `${SHARED_EMAIL_PATH} not found. The "setup" project (auth.setup.ts) must run first.`,
    );
  }
  return readFileSync(SHARED_EMAIL_PATH, "utf-8");
}

// 登録とサインインの画面操作（OTPメール確認）の検証はsignin.spec.tsが
// 担うため、それ以外のテストでは管理APIで確認済みユーザーを直接作成し、Mailpitへの
// OTPポーリングを経由しない。
export async function createConfirmedUser(input: {
  email: string;
  password?: string;
  storedPassword?: string;
}): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error("Missing Supabase environment variables in e2e helper.");
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase.auth.admin.createUser({
    email: input.email,
    ...(input.storedPassword ? { password: input.storedPassword } : {}),
    email_confirm: true,
  });
  if (error && !/already been registered|already exists/i.test(error.message)) {
    throw error;
  }
}

// ローカルDBの利用者のメールアドレス。画面を通した登録で、その利用者が作られたことを確かめるために使う。
export async function emailOfUser(userId: string): Promise<string | undefined> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error("Missing Supabase environment variables in e2e helper.");
  }
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data.user?.email;
}

function cookieExpiry(options: CookieOptions): number {
  if (options.maxAge !== undefined)
    return Math.floor(Date.now() / 1000) + options.maxAge;
  if (options.expires instanceof Date)
    return Math.floor(options.expires.getTime() / 1000);
  return -1;
}

function cookieSameSite(
  value: CookieOptions["sameSite"],
): "Strict" | "None" | "Lax" {
  if (value === "strict" || value === true) return "Strict";
  return value === "none" ? "None" : "Lax";
}

// Nextのローカルrewriteと揃え、Cookie名の導出・符号化・分割はSDKへ任せる。
function cookieSessionClient(appUrl: string) {
  const upstreamUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!upstreamUrl || !publicKey) {
    throw new Error("Missing Supabase environment variables in e2e helper.");
  }
  const origin = new URL(appUrl);
  const authUrl =
    new URL(upstreamUrl).hostname === "127.0.0.1"
      ? new URL("/supabase-api", origin).href
      : upstreamUrl;
  const cookies = new Map<
    string,
    Parameters<BrowserContext["addCookies"]>[0][number]
  >();
  const supabase = createServerClient(authUrl, publicKey, {
    cookies: {
      getAll: () =>
        [...cookies.values()].map(({ name, value }) => ({ name, value })),
      setAll(values) {
        values.forEach(({ name, value, options }) => {
          cookies.set(name, {
            name,
            value,
            domain: origin.hostname,
            path: options.path ?? "/",
            expires: cookieExpiry(options),
            httpOnly: options.httpOnly ?? false,
            secure: options.secure ?? origin.protocol === "https:",
            sameSite: cookieSameSite(options.sameSite),
          });
        });
      },
    },
  });
  return { supabase, cookies };
}

let preparationOrder = 0;
// contextごとの、保存を空にする指定を持つ最新の準備の順番。
const clearingOrders = new WeakMap<BrowserContext, number>();

// 端末の利用者の記憶が空か別の利用者のままだと、アプリが利用者の切り替えとして最初の画面を読み込み直し、テストの操作と競合する。
// 記憶は準備の後に最初に読み込む文書で1回だけ書き、アプリがサインアウトで消した記憶は戻さない。
// Playwrightは初期化スクリプトの実行順を定めないため、後の準備の優先と保存の消去は、準備の順番で判定する。
async function rememberLocalUser(
  context: BrowserContext,
  appUrl: string,
  userId: string,
  clearStorage: boolean,
): Promise<void> {
  const order = ++preparationOrder;
  if (clearStorage) clearingOrders.set(context, order);
  await context.addInitScript(
    ({ origin, userId, order, clearBefore }) => {
      if (location.origin !== origin) return;
      const applied = Number(localStorage.getItem("aims:e2e-prepared") ?? 0);
      if (applied >= order) return;
      if (applied < clearBefore) localStorage.clear();
      localStorage.setItem("aims:e2e-prepared", String(order));
      localStorage.setItem("aims:local-user-id", userId);
    },
    {
      origin: new URL(appUrl).origin,
      userId,
      order,
      clearBefore: clearingOrders.get(context) ?? 0,
    },
  );
}

// UI認証が検証対象でないケースの新しいcontextへ、実SDKが作ったセッションを渡す。
export async function prepareConfirmedUserSession(
  context: BrowserContext,
  appUrl: string,
  input: { email: string; password: string },
  options?: { clearStorage?: boolean },
): Promise<string> {
  await createConfirmedUser(input);
  const { supabase, cookies } = cookieSessionClient(appUrl);
  try {
    const { data, error } = await signInWithEmailOtp(supabase, input.email);
    if (error || !data.user)
      throw new Error(
        `OTP verification failed: ${error?.code ?? "missing user"}`,
      );
    await context.addCookies([...cookies.values()]);
    await rememberLocalUser(
      context,
      appUrl,
      data.user.id,
      options?.clearStorage ?? false,
    );
    await rememberTestSession(context, input.email);
    return data.user.id;
  } finally {
    await supabase.auth.stopAutoRefresh();
  }
}

// 準備のAPIで既に確認済みのセッション(testUserSession)を、メールを送らずにcontextへ渡す。
// UIのサインインが検証対象でない端末で、同じ宛先への2通目の送信間隔待ちを避ける。
export async function injectStoredSession(
  context: BrowserContext,
  appUrl: string,
  email: string,
): Promise<void> {
  const stored = testUserSession(email);
  if (!stored) throw new Error(`No stored session for ${email}.`);
  const { supabase, cookies } = cookieSessionClient(appUrl);
  try {
    const { data, error } = await supabase.auth.setSession(stored);
    if (error || !data.user)
      throw new Error(
        `Session injection failed: ${error?.code ?? "missing user"}`,
      );
    await context.addCookies([...cookies.values()]);
    await rememberLocalUser(context, appUrl, data.user.id, false);
    await rememberTestSession(context, email);
  } finally {
    await supabase.auth.stopAutoRefresh();
  }
}

// サインインを押し、一覧(`/rounds`配下)へ移って水和するまで待つ。
export async function clickSignInAndAwaitRounds(
  page: Page,
  signInButton: Locator,
): Promise<void> {
  await signInButton.click();
  await expect(page).toHaveURL(/\/rounds/);
  await waitForHydration(page);
}

export async function signUpAndSignIn(
  page: Page,
  input: { email: string; password: string },
): Promise<void> {
  await createConfirmedUser(input);

  await resetOtpSendInterval(input.email);
  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(input.email);
  const previous = await mailIds(input.email);
  await waitForTurnstileToken(page, 1);
  await page.getByRole("button", { name: authText("emailContinue") }).click();
  await expect(
    page.getByPlaceholder(authText("otpCodePlaceholder")),
  ).toBeVisible();
  const code = await getOtpCodeFromMailpit(input.email, previous);
  await page.getByPlaceholder(authText("otpCodePlaceholder")).fill(code);
  await clickSignInAndAwaitRounds(
    page,
    page.getByRole("button", { name: authText("otpVerify"), exact: true }),
  );
  await rememberTestSession(page.context(), input.email);
}

// 設定パネルは水和の後に開くため、表示された時点でハンドラが接続済みである。サインアウトのボタンを押して、確認のダイアログが開くまで待つ。
async function openSignOutConfirm(page: Page): Promise<void> {
  await page.getByRole("button", { name: authText("signOut") }).click();
  await expect(
    page.getByRole("button", { name: authText("signOutConfirmLabel") }),
  ).toBeVisible();
}

// 左パネルの設定の項目で設定パネルを開き、サインアウトを確認して、サインイン画面へ移ったことの確認で終わる。
// 画面を読み込み直さず、項目を押して開く(端末内のデータを保った経路を保つため)。
export async function signOutFromSettings(page: Page): Promise<void> {
  await page
    .getByRole("link", {
      name: navigationText("leftPanelSettings"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: settingsText("title") }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#settings\/account$/);
  await openSignOutConfirm(page);
  await page
    .getByRole("button", { name: authText("signOutConfirmLabel") })
    .click();
  await expect(page).toHaveURL(/\/signin/);
}

// UI認証が対象でない準備も公開OTPと実メールを使い、セッションを共有しない。
export async function signInWithEmailOtp(
  client: SupabaseClient,
  email: string,
) {
  const previous = await mailIds(email);
  await resetOtpSendInterval(email);
  const sent = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, captchaToken: "test-captcha-token" },
  });
  if (sent.error) throw new Error(`OTP request failed: ${sent.error.code}`);
  const token = await getOtpCodeFromMailpit(email, previous);
  const result = await client.auth.verifyOtp({ email, token, type: "email" });
  const session = result.data.session;
  if (session && !testSessions().has(email))
    testSessions().set(email, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
  return result;
}

let sessionScope = "";
const sessions = new Map<
  string,
  { access_token: string; refresh_token: string }
>();
function testSessions() {
  const current = test.info().testId;
  if (current !== sessionScope) {
    sessions.clear();
    sessionScope = current;
  }
  return sessions;
}
async function rememberTestSession(context: BrowserContext, email: string) {
  const tokens = await readStoredTokens(context);
  testSessions().set(email, {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
}
// 同じテスト内のデータ準備は、そのテストで実際に確認済みのOTPセッションを使う。
export function testUserSession(email: string) {
  return testSessions().get(email);
}

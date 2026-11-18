import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { translatorFor } from "@/i18n/translator-test-helpers";
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

export function getSharedEmail(): string {
  if (!existsSync(SHARED_EMAIL_PATH)) {
    throw new Error(
      `${SHARED_EMAIL_PATH} not found. The "setup" project (auth.setup.ts) must run first.`,
    );
  }
  return readFileSync(SHARED_EMAIL_PATH, "utf-8");
}

// サインアップ自体（OTPメール確認）の検証はsignup.spec.ts/reset-password.spec.tsが
// 担うため、それ以外のテストでは管理APIで確認済みユーザーを直接作成し、Mailpitへの
// OTPポーリングを経由しない。
export async function createConfirmedUser(input: {
  email: string;
  password: string;
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
    password: input.password,
    email_confirm: true,
  });
  if (error && !/already been registered|already exists/i.test(error.message)) {
    throw error;
  }
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

// UI認証が検証対象でないケースの新しいcontextへ、実SDKが作ったセッションを渡す。
export async function prepareConfirmedUserSession(
  context: BrowserContext,
  appUrl: string,
  input: { email: string; password: string },
): Promise<void> {
  await createConfirmedUser(input);
  const upstreamUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!upstreamUrl || !publicKey) {
    throw new Error("Missing Supabase environment variables in e2e helper.");
  }
  const origin = new URL(appUrl);
  // Nextのローカルrewriteと揃え、Cookie名の導出・符号化・分割はSDKへ任せる。
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
  try {
    const { error } = await supabase.auth.signInWithPassword({
      ...input,
      options: { captchaToken: "test-captcha-token" },
    });
    if (error) throw error;
    await context.addCookies([...cookies.values()]);
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

  await page.goto("/signin");
  await waitForHydration(page);
  await page.getByPlaceholder("you@example.com").fill(input.email);
  await page
    .getByPlaceholder(authText("passwordPlaceholder"))
    .fill(input.password);
  const signInButton = page.getByRole("button", {
    name: authText("signInSubmit"),
  });
  await waitForTurnstileToken(page, 1);
  await clickSignInAndAwaitRounds(page, signInButton);
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

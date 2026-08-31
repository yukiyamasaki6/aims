import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const SHARED_AUTH_STATE_PATH = "playwright/.auth/e2e-shared-user.json";
export const SHARED_EMAIL = "e2e-shared@aims.test";
export const SHARED_PASSWORD = "password-e2e-shared";

// サインアップ自体（OTPメール確認）の検証はauth.spec.ts/reset-password.spec.tsが
// 担うため、それ以外のテストでは管理APIで確認済みユーザーを直接作成し、Mailpitへの
// OTPポーリングを経由せずサインインだけをUIで行う。共有E2Eユーザーはローカルでの
// 繰り返し実行に対応するため固定メールアドレスを使うので、既に存在する場合の
// エラーは無視してそのままサインインへ進む。
export async function signUpAndSignIn(
  page: Page,
  input: { email: string; password: string },
): Promise<void> {
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

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(input.email);
  await page.getByPlaceholder("パスワード").fill(input.password);
  await page.getByRole("button", { name: "サインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);
}

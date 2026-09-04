import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const SHARED_AUTH_STATE_PATH = "playwright/.auth/e2e-shared-user.json";
const SHARED_EMAIL_PATH = "playwright/.auth/e2e-shared-email.txt";
export const SHARED_PASSWORD = "password-e2e-shared";

// テストは毎回同じ初期状態から始まるべきという原則を、DBリセットに頼らず
// 保証する。rounds/round_presetsはユーザー単位でRLS・owner_idにより
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

// サインアップ自体（OTPメール確認）の検証はauth.spec.ts/reset-password.spec.tsが
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

export async function signUpAndSignIn(
  page: Page,
  input: { email: string; password: string },
): Promise<void> {
  await createConfirmedUser(input);

  await page.goto("/signin");
  await page.getByPlaceholder("you@example.com").fill(input.email);
  await page.getByPlaceholder("パスワード").fill(input.password);
  await page.getByRole("button", { name: "サインイン" }).click();
  await expect(page).toHaveURL(/\/rounds/);
}

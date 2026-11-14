import { createClient } from "@supabase/supabase-js";

// 認証サービスの直接の呼び出し。画面を通さずに、応答のステータスとエラーコードを確かめるために使う。

function environment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing Supabase environment variables in e2e helper.");
  }
  return { url, anonKey };
}

export type AuthApiResponse = { status: number; errorCode: string | null };

async function respond(response: Response): Promise<AuthApiResponse> {
  const body = await response.json().catch(() => null);
  return { status: response.status, errorCode: body?.error_code ?? null };
}

// `PUT /auth/v1/user`。本文は呼び出し側が決める(現在のパスワードを付けない更新も呼べる)。
export async function updatePasswordDirect(
  accessToken: string,
  body: { password: string; current_password?: string },
): Promise<AuthApiResponse> {
  const { url, anonKey } = environment();
  return respond(
    await fetch(`${url}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

// `GET /auth/v1/user`。
export async function getUserStatus(
  accessToken: string,
): Promise<AuthApiResponse> {
  const { url, anonKey } = environment();
  return respond(
    await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
    }),
  );
}

// `POST /auth/v1/token?grant_type=refresh_token`。
export async function refreshStatus(
  refreshToken: string,
): Promise<AuthApiResponse> {
  const { url, anonKey } = environment();
  return respond(
    await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }),
  );
}

// 検証の対象のセッションとは別のクライアントで、その資格情報でサインインできるかを確かめる。
// サインインできれば null、拒否されればエラーコードを返す。
export async function signInError(email: string, password: string) {
  const { url, anonKey } = environment();
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: "test-captcha-token" },
  });
  return error?.code ?? null;
}

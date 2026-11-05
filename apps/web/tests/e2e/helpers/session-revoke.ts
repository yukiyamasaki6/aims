import { createClient } from "@supabase/supabase-js";

// 同じユーザーの別セッションを作り、そのアクセストークンで管理APIから
// 全セッションを無効化する（サーバー側でリフレッシュトークンが拒否される状態にする）。
export async function revokeAllSessions(input: {
  email: string;
  password: string;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !anonKey || !secretKey) {
    throw new Error("Missing Supabase environment variables in e2e test.");
  }
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  const user = createClient(url, anonKey, options);
  const { data, error } = await user.auth.signInWithPassword({
    email: input.email,
    password: input.password,
    // Turnstileの公式テストキーは、どのトークンでも検証を通過させる。
    options: { captchaToken: "XXXX.DUMMY.TOKEN.XXXX" },
  });
  if (error || !data.session) throw error ?? new Error("no session");
  const admin = createClient(url, secretKey, options);
  const result = await admin.auth.admin.signOut(
    data.session.access_token,
    "global",
  );
  if (result.error) throw result.error;
}

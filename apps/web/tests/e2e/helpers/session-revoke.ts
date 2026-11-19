import { createClient } from "@supabase/supabase-js";
import { signInWithEmailOtp, testUserSession } from "./auth";

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
  const stored = testUserSession(input.email);
  const { data, error } = stored
    ? await user.auth.setSession(stored)
    : await signInWithEmailOtp(user, input.email);
  if (error || !data.session) throw error ?? new Error("no session");
  const admin = createClient(url, secretKey, options);
  const result = await admin.auth.admin.signOut(
    data.session.access_token,
    "global",
  );
  if (result.error) throw result.error;
}

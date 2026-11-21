import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables in client.");
  }

  // URLの`code`は自動で交換しない。Googleでの認証の戻りは、戻り先の画面が明示して1回だけ交換する(自動の交換は、最初に接続を使った画面が、別の検証子の`code`を先に消費しうるため)。
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { detectSessionInUrl: false },
  });
}

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// サーバーでの認証サービスへの接続(管理者)。ブラウザの接続はclient.ts。

// 管理者の接続(登録確認)。秘密の鍵を使う。
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    throw new Error("Missing Supabase environment variables in admin client.");
  }

  return createSupabaseClient<Database>(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

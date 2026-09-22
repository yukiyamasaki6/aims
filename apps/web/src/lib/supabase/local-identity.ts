import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "aims:local-user-id";

// オフライン中はサーバーに問い合わせられないため、Supabaseセッション
// （JWT）の有効期限とは無関係に「この端末に最後にサインインしていたのは
// 誰か」を保持する。オフライン中にアクセストークンが失効しても、それだけで
// 自分のローカルデータ（未同期の入力等）にアクセスできなくなってはならない。
export function getLocalIdentity(): string | null {
  // SSR中に誤って呼ばれた場合の防御。jsdomのテスト環境ではwindowが
  // 常に存在するため、このガードは到達不能で検証できない。
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setLocalIdentity(userId: string | null): void {
  // getLocalIdentity同様、SSR中の呼び出しに対する防御でテスト環境では到達不能。
  if (typeof window === "undefined") return;
  try {
    if (userId) {
      window.localStorage.setItem(STORAGE_KEY, userId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない場合は何もできない。
  }
}

// 更新・削除はonAuthStateChangeのイベントのみを情報源とし、個々のAPI呼び出しの
// 成否には依存させない。SupabaseのSDK実装は、signOut({ scope: "local" })の
// サーバー通信が失敗してもローカルセッションの削除自体は必ず行い、SIGNED_OUTを
// 確実に発火するため、これを唯一の信頼できるクリアのトリガーとする。
//
// 記録はSIGNED_IN/SIGNED_OUTだけでなく、INITIAL_SESSIONでも設定する
// （クリアはしない）。ページ再読み込みで既存セッションが復元される場合、
// SupabaseはSIGNED_INではなくINITIAL_SESSIONを発火するため、これを
// 無視すると既にサインイン済みのユーザーの識別情報がいつまでも設定
// されない（新規の未同期操作がuserId: nullで書き込まれ続ける）。
// INITIAL_SESSIONでsessionが無い場合は「未サインイン」ではなく
// 「オフライン等でセッションを検証できなかった」可能性があるため、
// 既存の記録はクリアしない。
export function initLocalIdentity(supabase: SupabaseClient): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      if (session?.user.id) {
        setLocalIdentity(session.user.id);
      }
    } else if (event === "SIGNED_OUT") {
      setLocalIdentity(null);
    }
  });
  return () => subscription.unsubscribe();
}

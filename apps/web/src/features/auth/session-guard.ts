import type { SupabaseClient } from "@supabase/supabase-js";
import { signInHref } from "@/features/auth/return-to";
import { isOffline } from "@/features/fetch-result/network";
import { classifySession } from "./session-state";

let redirected = false;
let explicitSignOut = false;

// 同一タブの明示サインアウトでは、SIGNED_OUTの遷移に遷移元を付けない。
export function markExplicitSignOut(): void {
  explicitSignOut = true;
}

export function clearExplicitSignOut(): void {
  explicitSignOut = false;
}

// 入力が重なっても遷移は1回にする。ハードナビゲーションで、前の利用者の
// 画面の状態とRouter Cacheを捨てる。
export function redirectToSignIn(): void {
  if (redirected) return;
  redirected = true;
  window.location.replace(
    explicitSignOut
      ? "/signin"
      : signInHref(window.location.pathname + window.location.search),
  );
}

// セッション喪失は、SIGNED_OUTと、オンラインでのgetSession()の
// unauthenticatedに限る。INITIAL_SESSIONのnullと通信失敗
// （AuthRetryableFetchError）は通信失敗でも起きるため使わない。
// オフラインで/signinへ移ると行き止まりになるため、判定はオンラインまで保留する。
export function watchSessionLoss(
  supabase: SupabaseClient,
  { onLost }: { onLost: () => void },
): () => void {
  let disposed = false;

  async function check() {
    if (isOffline()) return;
    const result = await supabase.auth.getSession();
    if (disposed) return;
    if (classifySession(result).status === "unauthenticated") onLost();
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") onLost();
  });
  window.addEventListener("online", check);
  void check();

  return () => {
    disposed = true;
    subscription.unsubscribe();
    window.removeEventListener("online", check);
  };
}

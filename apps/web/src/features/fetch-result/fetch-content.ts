import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionFailureMessage } from "@/features/auth/errors";
import { classifySession } from "@/features/auth/session-state";
import {
  classifyResponse,
  FETCH_ERROR_MESSAGE,
  type FetchResult,
  type ResponseLike,
} from "./fetch-result";
import { isOffline } from "./network";

// getSession()は待機に時間制限を設けず、offlineイベントと競わせる。
// 遷移はSessionGuardが担い、ここでは行わない。
function waitOffline(): { promise: Promise<"offline">; stop: () => void } {
  const { promise, resolve } = Promise.withResolvers<"offline">();
  const onOffline = () => resolve("offline");
  window.addEventListener("offline", onOffline);
  return {
    promise,
    stop: () => window.removeEventListener("offline", onOffline),
  };
}

// runは呼び出し側が.retry(false)を付けたクエリを返す。
export async function fetchContent<T>(
  supabase: SupabaseClient,
  run: () => PromiseLike<ResponseLike<T>>,
  opts: { nullIsNotFound?: boolean } = {},
): Promise<FetchResult<T>> {
  if (isOffline()) return { status: "offline" };

  const offline = waitOffline();
  let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>>;
  try {
    const raced = await Promise.race([
      supabase.auth.getSession(),
      offline.promise,
    ]);
    if (raced === "offline") return { status: "offline" };
    sessionResult = raced;
  } catch {
    return { status: "offline" };
  } finally {
    offline.stop();
  }

  const state = classifySession(sessionResult);
  if (state.status === "unknown") return { status: "offline" };
  if (state.status === "unauthenticated") {
    return { status: "error", message: sessionFailureMessage(state) };
  }

  try {
    return classifyResponse(await run(), opts);
  } catch {
    return { status: "error", message: FETCH_ERROR_MESSAGE };
  }
}

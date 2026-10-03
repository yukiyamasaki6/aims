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

// 取得が終わらないまま枠が「読み込み中」に固定されないよう、全体に時間制限を設ける。
// navigator.onLineがtrueのまま通信できない場合、アクセストークンが期限切れだと
// getSession()の更新の再試行だけで約30秒、通信が応答しないと数分止まるため。
// 超えたら原因を断定せずerrorとして再試行できるようにする（遅れて届いた結果は捨てる）。
export const FETCH_TIMEOUT_MS = 10_000;

// getSession()は、offlineイベントと競わせる。
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

// 通信失敗由来の結果。取得中に回線が落ちてnavigator.onLineがfalseになっていればofflineにし、
// 復帰のonlineイベントで再取得できるようにする。それ以外は原因を断定せずerrorにする。
function commFailure<T>(): FetchResult<T> {
  if (isOffline()) return { status: "offline" };
  return { status: "error", message: FETCH_ERROR_MESSAGE };
}

// runは呼び出し側が.retry(false)を付けたクエリを返す。
export async function fetchContent<T>(
  supabase: SupabaseClient,
  run: () => PromiseLike<ResponseLike<T>>,
  opts: { nullIsNotFound?: boolean } = {},
): Promise<FetchResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<FetchResult<T>>((resolve) => {
    timer = setTimeout(() => resolve(commFailure()), FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([load(supabase, run, opts), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function load<T>(
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
    return commFailure();
  } finally {
    offline.stop();
  }

  const state = classifySession(sessionResult);
  if (state.status === "unknown") return commFailure();
  if (state.status === "unauthenticated") {
    return { status: "error", message: sessionFailureMessage(state) };
  }

  try {
    const res = await run();
    if (res.status === 0) return commFailure();
    return classifyResponse(res, opts);
  } catch {
    return commFailure();
  }
}

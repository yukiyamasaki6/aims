import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { sessionFailureMessage } from "@/features/auth/errors";
import { readSession, type SessionState } from "@/features/auth/session-state";
import {
  classifyResponse,
  FETCH_ERROR_MESSAGE,
  type FetchResult,
  isAuthRejected,
  type ResponseLike,
} from "./fetch-result";
import { isOffline } from "./network";

// 取得が終わらないまま枠が「読み込み中」に固定されないよう、全体に時間制限を設ける。
// navigator.onLineがtrueのまま通信できない場合、アクセストークンが期限切れだと
// readSessionの更新の再試行だけで約30秒、通信が応答しないと数分止まるため。
// 超えたら原因を断定せずerrorとして再試行できるようにする（遅れて届いた結果は捨てる）。
export const FETCH_TIMEOUT_MS = 10_000;

// readSessionは、offlineイベントと競わせる。
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

// 上限に達したときの代わりがある待ちはFALLBACK_WAIT_MS、無い待ちはFETCH_TIMEOUT_MSにする。
export const FALLBACK_WAIT_MS = 1_000;

const TIMED_OUT = Symbol("timed-out");

// runは、確かめたセッションを受け取り、呼び出し側が.retry(false)を付けたクエリを返す。
// timeoutMsは結果を返すまでの上限。超えた後も取得の開始からFETCH_TIMEOUT_MSまでは結果を待ち、
// 終われば一度だけonLateResultへ渡す（表示には使わず、保存などに使う）。
export async function fetchContent<T>(
  supabase: SupabaseClient,
  run: (session: Session) => PromiseLike<ResponseLike<T>>,
  opts: {
    nullIsNotFound?: boolean;
    timeoutMs?: number;
    onLateResult?: (result: FetchResult<T>) => void;
  } = {},
): Promise<FetchResult<T>> {
  const { timeoutMs = FETCH_TIMEOUT_MS, onLateResult, ...loadOpts } = opts;
  const loading = load(supabase, run, loadOpts);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    const raced = await Promise.race([loading, timeout]);
    if (raced !== TIMED_OUT) return raced;
    if (onLateResult && timeoutMs < FETCH_TIMEOUT_MS) {
      void deliverLateResult(
        loading,
        FETCH_TIMEOUT_MS - timeoutMs,
        onLateResult,
      );
    }
    return commFailure();
  } finally {
    clearTimeout(timer);
  }
}

async function deliverLateResult<T>(
  loading: Promise<FetchResult<T>>,
  remainingMs: number,
  onLateResult: (result: FetchResult<T>) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), remainingMs);
  });
  try {
    const raced = await Promise.race([loading, limit]);
    if (raced !== TIMED_OUT) onLateResult(raced);
  } finally {
    clearTimeout(timer);
  }
}

// セッションをofflineイベントと競わせて確かめる。認証済みでなければ、取得の結果をfailureで返す。
async function confirmSession<T>(
  supabase: SupabaseClient,
  opts: { refresh?: boolean } = {},
): Promise<{ session: Session } | { failure: FetchResult<T> }> {
  const offline = waitOffline();
  let state: SessionState;
  try {
    const raced = await Promise.race([
      readSession(supabase, opts),
      offline.promise,
    ]);
    if (raced === "offline") return { failure: { status: "offline" } };
    state = raced;
  } catch {
    return { failure: commFailure() };
  } finally {
    offline.stop();
  }
  if (state.status === "unknown") return { failure: commFailure() };
  if (state.status === "unauthenticated") {
    return {
      failure: { status: "error", message: sessionFailureMessage(state) },
    };
  }
  return { session: state.session };
}

// 確かめたセッションでクエリし、runの中では読み直さない。
// 認証の拒否が返ったら、更新を強制してセッションを確かめ、認証済みなら新しいセッションで1回だけ取り直す。
async function load<T>(
  supabase: SupabaseClient,
  run: (session: Session) => PromiseLike<ResponseLike<T>>,
  opts: { nullIsNotFound?: boolean } = {},
): Promise<FetchResult<T>> {
  if (isOffline()) return { status: "offline" };

  const confirmed = await confirmSession<T>(supabase);
  if ("failure" in confirmed) return confirmed.failure;

  try {
    let res = await run(confirmed.session);
    if (res.status === 0) return commFailure();
    if (isAuthRejected(res)) {
      const refreshed = await confirmSession<T>(supabase, { refresh: true });
      if ("failure" in refreshed) return refreshed.failure;
      res = await run(refreshed.session);
      if (res.status === 0) return commFailure();
    }
    return classifyResponse(res, opts);
  } catch {
    return commFailure();
  }
}

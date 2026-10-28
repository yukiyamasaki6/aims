import { retryDelayMs } from "@/features/op-log/sync-result";
import type { RoundOpSync } from "@/features/rounds/round-op-log";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createClient } from "@/lib/supabase/client";
import { type LoadedRound, loadRoundDetail } from "./load-round-detail";

// 通信の可否。
const connectivity = createBrowserConnectivity();

type RefetchEnv = {
  roundId: string;
  sync: RoundOpSync;
  // 取得できたら偽になる。端末のベースで開いたときだけ真で始まる。
  stale: { current: boolean };
  onGone: () => void;
  pendingServer: LoadedRound["pendingServer"];
  // 取り直しの要求。開始から後片付けまでの間だけ設定する。
  requestRefetch: { current: () => void };
};

// 取得は同時に1件まで。取得中に届いた知らせは、完了後にもう1度取得する。
type RefetchLoop = {
  fetching: boolean;
  again: boolean;
  active: boolean;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
};

function handleResult(
  env: RefetchEnv,
  loop: RefetchLoop,
  result: Awaited<ReturnType<typeof loadRoundDetail>>,
) {
  if (!loop.active) return;
  if (result.status === "ok" && !result.data.deleted) env.stale.current = false;
  const gone =
    result.status === "not-found" ||
    (result.status === "ok" && result.data.deleted);
  if (gone && env.stale.current) env.onGone();
}

async function refetch(env: RefetchEnv, loop: RefetchLoop) {
  if (loop.fetching) {
    loop.again = true;
    return;
  }
  // オフラインと取得の失敗では何もしない(次の知らせ、または再読み込みで取り直す)。
  if (connectivity.isOffline()) return;
  loop.fetching = true;
  try {
    // 取得は端末の組へ反映する。画面は組から状態を求めるため、結果は使わない。
    handleResult(
      env,
      loop,
      await loadRoundDetail(createClient(), env.roundId, {
        localFallback: false,
      }),
    );
  } catch {
    // 取得の失敗は何もしない。
  } finally {
    loop.fetching = false;
  }
  if (loop.again && loop.active) {
    loop.again = false;
    void refetch(env, loop);
  }
}

// 端末のベースで表示している間、`navigator.onLine`がtrueのまま通信が戻る場合のために、間隔を置いて取り直す。
function schedule(env: RefetchEnv, loop: RefetchLoop) {
  clearTimeout(loop.timer);
  if (!loop.active || !env.stale.current || connectivity.isOffline()) return;
  loop.timer = setTimeout(async () => {
    await refetch(env, loop);
    loop.attempt += 1;
    schedule(env, loop);
  }, retryDelayMs(loop.attempt));
}

function restart(env: RefetchEnv, loop: RefetchLoop) {
  loop.attempt = 0;
  void refetch(env, loop);
  schedule(env, loop);
}

// 端末のベースで開いたときの取り直しを始める。戻り値は後片付け。
export function startBaseRefetch(env: RefetchEnv): () => void {
  const { sync, stale } = env;
  sync.wake();

  const loop: RefetchLoop = {
    fetching: false,
    again: false,
    active: true,
    attempt: 0,
    timer: undefined,
  };
  const handleOnline = () => restart(env, loop);
  const handleOffline = () => clearTimeout(loop.timer);
  const handleVisible = () => {
    if (document.visibilityState === "visible" && stale.current) {
      restart(env, loop);
    }
  };

  const unsubscribeDiverged = sync.subscribeDiverged(() => {
    void refetch(env, loop);
  });
  env.requestRefetch.current = () => {
    void refetch(env, loop);
  };
  if (stale.current) {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisible);
    schedule(env, loop);
    void env.pendingServer?.then((result) => handleResult(env, loop, result));
  }

  return () => {
    loop.active = false;
    env.requestRefetch.current = noop;
    clearTimeout(loop.timer);
    unsubscribeDiverged();
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    document.removeEventListener("visibilitychange", handleVisible);
  };
}

function noop() {}

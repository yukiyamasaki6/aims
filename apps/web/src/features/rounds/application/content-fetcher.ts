import type { SessionReader } from "@/features/auth";
import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  commFailure,
  type FetchResult,
  fetchResultOf,
  signInFailure,
} from "../domain/fetch-status";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import type { QueryOutcome } from "../domain/query-outcome";
import { TIMED_OUT, withinTime } from "./time-limit";

type FetchOptions<T> = {
  timeoutMs?: number;
  onLateResult?: (result: FetchResult<T>) => void;
};

export type ContentFetcher = {
  fetchContent<T>(
    run: (session: { userId: string }) => PromiseLike<QueryOutcome<T>>,
    opts?: FetchOptions<T>,
  ): Promise<FetchResult<T>>;
};

// 認証を確かめた取得と取り直し、時間制限。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createContentFetcher(deps: {
  sessionReader: SessionReader;
  connectivity: Connectivity;
  clock: Clock;
}): ContentFetcher {
  const { sessionReader, connectivity, clock } = deps;

  function failureOfComm<T>(): FetchResult<T> {
    return commFailure(connectivity.isOffline());
  }

  // サインインの状態を、切断と競わせて確かめる。認証済みでなければ、取得の結果をfailureで返す。
  async function confirmSession<T>(
    opts: { refresh?: boolean } = {},
  ): Promise<{ session: { userId: string } } | { failure: FetchResult<T> }> {
    const { promise, resolve } = Promise.withResolvers<"offline">();
    const stop = connectivity.onOffline(() => resolve("offline"));
    let reading: Awaited<ReturnType<SessionReader["readSession"]>>;
    try {
      const raced = await Promise.race([
        sessionReader.readSession(opts),
        promise,
      ]);
      if (raced === "offline") return { failure: { status: "offline" } };
      reading = raced;
    } finally {
      stop();
    }
    if (reading.status === "unknown") return { failure: failureOfComm() };
    if (reading.status === "unauthenticated") {
      return {
        failure: { status: "error", reason: signInFailure(reading.status) },
      };
    }
    return { session: { userId: reading.userId } };
  }

  // 確かめたセッションでクエリし、runの中では読み直さない。
  // 認証の拒否が返ったら、更新を強制してセッションを確かめ、認証済みなら新しいセッションで1回だけ取り直す。
  async function load<T>(
    run: (session: { userId: string }) => PromiseLike<QueryOutcome<T>>,
  ): Promise<FetchResult<T>> {
    if (connectivity.isOffline()) return { status: "offline" };
    const confirmed = await confirmSession<T>();
    if ("failure" in confirmed) return confirmed.failure;
    try {
      let outcome = await run(confirmed.session);
      if (outcome.status === "auth-rejected") {
        const refreshed = await confirmSession<T>({ refresh: true });
        if ("failure" in refreshed) return refreshed.failure;
        outcome = await run(refreshed.session);
      }
      return fetchResultOf(outcome, connectivity.isOffline());
    } catch {
      return failureOfComm();
    }
  }

  async function deliverLateResult<T>(
    loading: Promise<FetchResult<T>>,
    remainingMs: number,
    onLateResult: (result: FetchResult<T>) => void,
  ): Promise<void> {
    const raced = await withinTime(clock, loading, remainingMs);
    if (raced !== TIMED_OUT) onLateResult(raced);
  }

  // timeoutMsは結果を返すまでの上限。超えた後も取得の開始からFETCH_TIMEOUT_MSまでは結果を待ち、
  // 終われば一度だけonLateResultへ渡す（表示には使わず、保存などに使う）。
  async function fetchContent<T>(
    run: (session: { userId: string }) => PromiseLike<QueryOutcome<T>>,
    opts: FetchOptions<T> = {},
  ): Promise<FetchResult<T>> {
    const { timeoutMs = FETCH_TIMEOUT_MS, onLateResult } = opts;
    const loading = load(run);
    const raced = await withinTime(clock, loading, timeoutMs);
    if (raced !== TIMED_OUT) return raced;
    if (onLateResult && timeoutMs < FETCH_TIMEOUT_MS) {
      void deliverLateResult(
        loading,
        FETCH_TIMEOUT_MS - timeoutMs,
        onLateResult,
      );
    }
    return failureOfComm();
  }

  return { fetchContent };
}

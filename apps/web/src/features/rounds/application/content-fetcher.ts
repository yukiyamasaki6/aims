import type { SessionReader } from "@/features/auth";
import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  commFailure,
  type FetchResult,
  fetchResultOf,
} from "../domain/fetch-status";
import type { QueryOutcome } from "../domain/query-outcome";
import { withinFetchTimeout } from "./time-limit";

export type ContentFetcher = {
  fetchContent<T>(
    run: (session: { userId: string }) => PromiseLike<QueryOutcome<T>>,
  ): Promise<FetchResult<T>>;
};

// 認証を確かめた取得と取り直し、時間制限。
export function createContentFetcher(deps: {
  sessionReader: SessionReader;
  connectivity: Connectivity;
  clock: Clock;
}): ContentFetcher {
  const { sessionReader, connectivity, clock } = deps;

  function failureOfComm<T>(): FetchResult<T> {
    return commFailure(connectivity.isOffline());
  }

  // サインインの状態を確かめる。認証済みでなければ、取得の結果をfailureで返す。
  async function confirmSession<T>(
    opts: { refresh?: boolean } = {},
  ): Promise<{ session: { userId: string } } | { failure: FetchResult<T> }> {
    const reading = await sessionReader.readSession(opts);
    if (reading.status === "unknown") return { failure: failureOfComm() };
    if (reading.status === "unauthenticated") {
      return { failure: { status: "error", reason: "unauthenticated" } };
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

  // FETCH_TIMEOUT_MSで打ち切り、超えたら原因を断定せずに失敗にする(遅れて届いた結果は捨てる)。
  function fetchContent<T>(
    run: (session: { userId: string }) => PromiseLike<QueryOutcome<T>>,
  ): Promise<FetchResult<T>> {
    return withinFetchTimeout(clock, connectivity, load(run));
  }

  return { fetchContent };
}

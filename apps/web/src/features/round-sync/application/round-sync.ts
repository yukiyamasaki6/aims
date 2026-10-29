import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  beginFlight,
  endFlight,
  type FlightGate,
  IDLE_GATE,
} from "../domain/flight-gate";
import { retryDelayMs } from "../domain/sync-failure";
import {
  type RefreshReason,
  refreshDecision,
  shouldRefetch,
} from "../domain/sync-trigger";
import type { OpSender } from "./op-sender";
import type { RecordsPort } from "./records-port";
import type { SessionCheck } from "./session-check";

export type RoundSync = ReturnType<typeof createRoundSync>;

type Wanted = { resident: boolean; list: boolean };

const NOTHING: Wanted = { resident: false, list: false };

// いつ送り、いつ取り直すかを決める唯一の手続き。契機(認証の通知、通信の復帰と切断、見える状態)と、画面の依頼を受けて、送信器と、ベースの取得と反映を動かす。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRoundSync(deps: {
  records: RecordsPort;
  sender: OpSender;
  session: SessionCheck;
  clock: Clock;
  connectivity: Connectivity;
}) {
  const { records, sender, session, clock, connectivity } = deps;
  let active = false;
  // 開始と停止のたびに進める。停止をまたぐ古い処理が、新しい状態を変えないため。
  let epoch = 0;
  let staleSeq = 0;
  // 端末のベースの取り直しの時計ごとの印。時計を作り直した(閉じた、開き直した)とき、古い処理の続きを捨てるため。
  const staleTokens = new Map<string, number>();
  let allGate: FlightGate = IDLE_GATE;
  let wanted: Wanted = NOTHING;
  let refreshed = 0;
  const refreshedListeners = new Set<(count: number) => void>();
  const roundGates = new Map<string, FlightGate>();
  // 端末のベースで開いている間の取り直しの、試行の番号と時計。
  const attempts = new Map<string, number>();
  const staleTimers = new Map<string, () => void>();
  const rerunReasons = new Map<string, RefreshReason>();
  // 前回の見直しで要ると判断した理由。新しく要る(または理由が変わった)ときだけ取り直しを始める。
  const lastReasons = new Map<string, RefreshReason>();
  let stopNeeds: (() => void) | undefined;

  // 常駐の前段。サインイン済みで、記録の利用者と同じときだけ通る。
  async function residentPass(): Promise<boolean> {
    try {
      const reading = await session.read();
      return (
        reading.status === "authenticated" &&
        records.matchUser(reading.userId) === "same"
      );
    } catch {
      return false;
    }
  }

  async function refreshOnce(cause: Wanted, target: number) {
    const residentAllowed = cause.resident ? await residentPass() : false;
    if (epoch !== target) return;
    const list = cause.list && records.refreshNeeds().list;
    const decision = refreshDecision({
      resident: cause.resident,
      residentAllowed,
      list,
    });
    if (!decision.fetch) return;
    const committed = await records.refreshAll({
      waitForList: decision.waitForList,
    });
    // 成功の回数は、常駐の前段を通って反映した実行だけを数える。停止をまたいだ結果は数えない。
    if (cause.resident && residentAllowed && committed && epoch === target) {
      refreshed += 1;
      for (const listener of [...refreshedListeners]) listener(refreshed);
    }
  }

  async function runAll() {
    const target = epoch;
    let again = true;
    while (again) {
      const cause = wanted;
      wanted = NOTHING;
      try {
        await refreshOnce(cause, target);
      } catch {
        // 取得の失敗は何もしない(次の契機で取り直す)。
      }
      // 停止をまたいだ処理は、新しい状態(ゲートと予約)に触れない。
      if (epoch !== target) return;
      const end = endFlight(allGate);
      allGate = end.gate;
      again = end.again;
    }
  }

  // 一括の取得を同時に1回までにする。実行中の契機は、完了後に1回だけやり直す。
  function requestRefresh(cause: Wanted) {
    wanted = {
      resident: wanted.resident || cause.resident,
      list: wanted.list || cause.list,
    };
    const begin = beginFlight(allGate);
    allGate = begin.gate;
    if (begin.run) void runAll();
  }

  function needOf(roundId: string) {
    return records
      .refreshNeeds()
      .rounds.find((need) => need.roundId === roundId);
  }

  // 予約した取り直しを行うか。詳細を閉じた(取り直しが要らなくなった)後や、停止後は行わない。オフラインでは開いた依頼以外は行わない。
  function shouldRerun(roundId: string): boolean {
    const rerun = rerunReasons.get(roundId);
    return (
      active &&
      rerun !== undefined &&
      needOf(roundId) !== undefined &&
      shouldRefetch(rerun, connectivity.isOffline())
    );
  }

  // 取り直しの1回が終わった。続けて行うなら真を返し、行わないならゲートと予約を空にする。
  function finishRun(roundId: string): boolean {
    const end = endFlight(roundGates.get(roundId) ?? IDLE_GATE);
    roundGates.set(roundId, end.gate);
    if (end.again && shouldRerun(roundId)) return true;
    roundGates.set(roundId, IDLE_GATE);
    rerunReasons.delete(roundId);
    return false;
  }

  // 1つのラウンドの取り直しを、同時に1回までにする。実行中に届いた知らせは、完了後にもう1度行う(オフラインでは開いた依頼以外は行わない)。
  async function refetchRound(roundId: string, reason: RefreshReason) {
    const begin = beginFlight(roundGates.get(roundId) ?? IDLE_GATE);
    roundGates.set(roundId, begin.gate);
    if (!begin.run) {
      rerunReasons.set(roundId, reason);
      return;
    }
    const target = epoch;
    let again = true;
    while (again) {
      rerunReasons.delete(roundId);
      try {
        await records.refreshRound(roundId);
      } catch {
        // 取得の失敗は何もしない。
      }
      // 停止をまたいだ処理は、新しい状態に触れない。
      if (epoch !== target) return;
      again = finishRun(roundId);
    }
  }

  function cancelStale(roundId: string) {
    staleTimers.get(roundId)?.();
    staleTimers.delete(roundId);
  }

  // 端末のベースで開いている間、`navigator.onLine`がtrueのまま通信が戻る場合のために、間隔を置いて取り直す。
  function scheduleStale(roundId: string) {
    cancelStale(roundId);
    if (!active || connectivity.isOffline()) return;
    staleSeq += 1;
    const token = staleSeq;
    staleTokens.set(roundId, token);
    const cancel = clock.after(retryDelayMs(attempts.get(roundId) ?? 0), () => {
      staleTimers.delete(roundId);
      void (async () => {
        await refetchRound(roundId, "stale");
        // 取り直しの間に時計を作り直した(閉じた、開き直した)ときは、新しい時計の試行番号を進めない。
        if (staleTokens.get(roundId) !== token) return;
        attempts.set(roundId, (attempts.get(roundId) ?? 0) + 1);
        if (needOf(roundId)?.reason === "stale") scheduleStale(roundId);
      })();
    });
    staleTimers.set(roundId, cancel);
  }

  // 依頼と記録の変化から、取り直しの要否を見直す。
  function evaluate() {
    if (!active) return;
    const needs = records.refreshNeeds();
    if (needs.list) requestRefresh({ resident: false, list: true });
    const offline = connectivity.isOffline();
    const staleIds = new Set<string>();
    const current = new Map<string, RefreshReason>();
    for (const need of needs.rounds) {
      current.set(need.roundId, need.reason);
      if (need.reason === "stale") staleIds.add(need.roundId);
      // 効かなかった結果は通知ごとに取り直す(実行中に届いたものは完了後に1回やり直す)。印は取り直しの開始で消えるため、繰り返さない。
      // 開く依頼は、実行中に追加されたものを完了後の取り直しへ引き継ぐため、通知ごとに求める(残る依頼が無ければ再実行しない)。
      const isNew =
        need.reason === "diverged" ||
        need.reason === "open" ||
        lastReasons.get(need.roundId) !== need.reason;
      if (isNew) applyNeed(need, offline);
    }
    lastReasons.clear();
    for (const [roundId, reason] of current) lastReasons.set(roundId, reason);
    cancelStaleExcept(staleIds);
  }

  // 端末のベースで開いたままの詳細は時計で取り直し、他の理由はすぐに取り直す。
  function applyNeed(
    need: { roundId: string; reason: RefreshReason },
    offline: boolean,
  ) {
    if (need.reason === "stale") {
      if (!staleTimers.has(need.roundId)) scheduleStale(need.roundId);
    } else if (shouldRefetch(need.reason, offline)) {
      void refetchRound(need.roundId, need.reason);
    }
  }

  // 取り直しが要らなくなったラウンドの時計を止める。
  function cancelStaleExcept(keep: ReadonlySet<string>) {
    for (const roundId of new Set([
      ...staleTimers.keys(),
      ...attempts.keys(),
    ])) {
      if (keep.has(roundId)) continue;
      // 取り直しが要らなくなった詳細は、時計と試行番号を捨てる(開き直したときは0から数える)。
      cancelStale(roundId);
      attempts.delete(roundId);
      staleTokens.delete(roundId);
    }
  }

  // 通信の復帰と見える状態で、端末のベースで開いている詳細の取り直しを、試行を0から数え直して始める。
  function restartStale() {
    for (const need of records.refreshNeeds().rounds) {
      if (need.reason !== "stale") continue;
      attempts.set(need.roundId, 0);
      void refetchRound(need.roundId, "stale");
      scheduleStale(need.roundId);
    }
  }

  return {
    start(userId: string | null) {
      if (active) return;
      active = true;
      epoch += 1;
      records.start(userId);
      sender.start();
      stopNeeds = records.onRefreshNeeds(evaluate);
      evaluate();
    },
    stop() {
      active = false;
      epoch += 1;
      stopNeeds?.();
      stopNeeds = undefined;
      for (const roundId of [...staleTimers.keys()]) cancelStale(roundId);
      allGate = IDLE_GATE;
      wanted = NOTHING;
      attempts.clear();
      staleTokens.clear();
      roundGates.clear();
      rerunReasons.clear();
      lastReasons.clear();
      sender.stop();
      records.stop();
    },
    // 利用者を切り替える。送信の状態を捨て、新しい利用者の記録を読み直す。
    switchUser(userId: string | null) {
      sender.reset();
      records.setUser(userId);
    },
    matchUser: (userId: string | null) => records.matchUser(userId),
    // 保留を戻して送る。
    resume() {
      sender.resumeHeld();
    },
    refreshAll(_cause: "resident") {
      requestRefresh({ resident: true, list: false });
    },
    online() {
      sender.online();
      requestRefresh({ resident: true, list: false });
      restartStale();
    },
    offline() {
      for (const roundId of [...staleTimers.keys()]) cancelStale(roundId);
    },
    visible() {
      requestRefresh({ resident: true, list: false });
      restartStale();
    },
    // 常駐の一括の取得が成功した回数の通知。
    subscribeRefreshed(listener: (count: number) => void) {
      refreshedListeners.add(listener);
      return () => {
        refreshedListeners.delete(listener);
      };
    },
  };
}

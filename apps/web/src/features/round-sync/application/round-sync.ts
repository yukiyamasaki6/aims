import type { SessionReader } from "@/features/auth";
import type {
  RoundRecordControl,
  RoundRefreshControl,
} from "@/features/rounds";
import type { Clock } from "@/lib/clock/contract/clock";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  beginFlight,
  endFlight,
  type FlightGate,
  IDLE_GATE,
} from "../domain/flight-gate";
import { staleRetryDelayMs } from "../domain/stale-retry";
import { refreshDecision, shouldRefetch } from "../domain/sync-trigger";

// 取り直しの理由。取り直しの制御が返す理由の型から導く。
type RefreshReason = ReturnType<
  RoundRefreshControl["refreshNeeds"]
>["rounds"][number]["reason"];

// ラウンドごとの扉と、完了後にやり直す予約。
type RoundLane = {
  gates: Map<string, FlightGate>;
  reruns: Map<string, RefreshReason>;
};

// `shouldRefetch`へ渡す、開く依頼ではない理由(diverged、overlay)の印。
const NOT_OPEN_REQUEST = false;

export type RoundSync = ReturnType<typeof createRoundSync>;

// いつ送り、いつ取り直すかを決める唯一の手続き。契機(認証の通知、通信の復帰と切断、見える状態)と、画面の依頼を受けて、記録の制御と取り直しの制御を動かす。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRoundSync(deps: {
  control: RoundRecordControl;
  refresh: RoundRefreshControl;
  session: Pick<SessionReader, "readSession">;
  clock: Clock;
  connectivity: Connectivity;
}) {
  const { control, refresh, session, clock, connectivity } = deps;
  let active = false;
  // 開始と停止のたびに進める。停止をまたぐ古い処理が、新しい状態を変えないため。
  let epoch = 0;
  let staleSeq = 0;
  // 端末のベースの取り直しの時計ごとの印。時計を作り直した(閉じた、開き直した)とき、古い処理の続きを捨てるため。
  const staleTokens = new Map<string, number>();
  // 同時に1回までの扉は、常駐の一括の取得と、ラウンドごとの取り直しの2種類だけに置く。一覧の一括の取得とラウンドごとの開く依頼は、依頼の番号ごとに扉なしで並行して実行する。
  let residentGate: FlightGate = IDLE_GATE;
  // 最後に実行を始めた一覧の依頼の番号と、ラウンドごとの開く依頼の番号。同じ番号のあいだは、記録の知らせが何度届いても、実行を重ねない。
  let startedList = 0;
  const startedOpen = new Map<string, number>();
  let refreshed = 0;
  const refreshedListeners = new Set<(count: number) => void>();
  const refetchLane: RoundLane = { gates: new Map(), reruns: new Map() };
  // 端末のベースで開いている間の取り直しの、試行の番号と時計。
  const attempts = new Map<string, number>();
  const staleTimers = new Map<string, () => void>();
  // 前回の見直しで要ると判断した理由。新しく要る(または理由が変わった)ときだけ取り直しを始める。
  const lastReasons = new Map<string, RefreshReason>();
  // 前回の見直しで、主の理由が stale のときに添えられていた diverged と overlay。overlay が新しく当たったかを知るため。
  const lastExtras = new Map<string, ReadonlySet<RefreshReason>>();
  let stopNeeds: (() => void) | undefined;

  // 常駐の前段。サインイン済みで、記録の利用者と同じときだけ通る。
  async function residentPass(): Promise<boolean> {
    try {
      const reading = await session.readSession();
      return (
        reading.status === "authenticated" &&
        control.matchUser(reading.userId) === "same"
      );
    } catch {
      return false;
    }
  }

  // 常駐の扉の1回。前段を通ったときだけ取得して反映し、反映したら成功の回数を数える。
  async function residentOnce(target: number) {
    const residentAllowed = await residentPass();
    if (epoch !== target) return;
    const decision = refreshDecision({ kind: "resident", residentAllowed });
    if (!decision.fetch) return;
    const committed = await refresh.refreshAll({
      waitForList: decision.waitForList,
    });
    // 停止をまたいだ結果は数えない。
    if (committed && epoch === target) {
      refreshed += 1;
      for (const listener of [...refreshedListeners]) listener(refreshed);
    }
  }

  // 一覧の依頼ごとの実行。一覧の依頼があるときだけ、一覧の取得が成功したときに反映する取得を行う。成功の回数は数えない。
  async function listRun() {
    try {
      if (!refresh.refreshNeeds().list) return;
      const decision = refreshDecision({ kind: "list" });
      await refresh.refreshAll({ waitForList: decision.waitForList });
    } catch {
      // 取得の失敗は何もしない(依頼は取得の結果で終わる)。
    }
  }

  // 開く依頼ごとの実行。
  async function openRun(roundId: string) {
    try {
      await refresh.refreshRound(roundId);
    } catch {
      // 取得の失敗は何もしない(依頼は取得の結果で終わる)。
    }
  }

  // 常駐の扉で一括の取得を行う。実行中の契機は、完了後に1回だけやり直す。
  async function runAll(
    once: (target: number) => Promise<void>,
    getGate: () => FlightGate,
    setGate: (gate: FlightGate) => void,
  ) {
    const target = epoch;
    let again = true;
    while (again) {
      try {
        await once(target);
      } catch {
        // 取得の失敗は何もしない(次の契機で取り直す)。
      }
      // 停止をまたいだ処理は、新しい状態(扉と予約)に触れない。
      if (epoch !== target) return;
      const end = endFlight(getGate());
      setGate(end.gate);
      again = end.again;
    }
  }

  function requestResident() {
    const begin = beginFlight(residentGate);
    residentGate = begin.gate;
    if (!begin.run) return;
    void runAll(
      residentOnce,
      () => residentGate,
      (gate) => {
        residentGate = gate;
      },
    );
  }

  function needOf(roundId: string) {
    return refresh
      .refreshNeeds()
      .rounds.find((need) => need.roundId === roundId);
  }

  // 予約した取り直しを行うか。詳細を閉じた(取り直しが要らなくなった)後や、停止後は行わない。
  // 要否の理由が取り直しの理由で、オフラインでないときだけ(開く依頼は、依頼ごとに別に実行する)。
  function shouldRerun(roundId: string): boolean {
    const rerun = refetchLane.reruns.get(roundId);
    const need = needOf(roundId);
    if (!active || rerun === undefined || need === undefined) return false;
    return (
      need.reason !== "open" &&
      shouldRefetch(rerun === "open", connectivity.isOffline())
    );
  }

  // 取り直しの1回が終わった。続けて行うなら真を返し、行わないなら扉と予約を空にする。
  function finishRun(roundId: string): boolean {
    const lane = refetchLane;
    const end = endFlight(lane.gates.get(roundId) ?? IDLE_GATE);
    lane.gates.set(roundId, end.gate);
    if (end.again && shouldRerun(roundId)) return true;
    lane.gates.set(roundId, IDLE_GATE);
    lane.reruns.delete(roundId);
    return false;
  }

  // 1つのラウンドの取り直しを、同時に1回までにする。実行中に届いた知らせは、完了後にもう1度行う。
  async function refetchRound(roundId: string, reason: RefreshReason) {
    const lane = refetchLane;
    const begin = beginFlight(lane.gates.get(roundId) ?? IDLE_GATE);
    lane.gates.set(roundId, begin.gate);
    if (!begin.run) {
      lane.reruns.set(roundId, reason);
      return;
    }
    const target = epoch;
    let again = true;
    while (again) {
      lane.reruns.delete(roundId);
      try {
        await refresh.refreshRound(roundId);
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
    const cancel = clock.after(
      staleRetryDelayMs(attempts.get(roundId) ?? 0),
      () => {
        staleTimers.delete(roundId);
        void (async () => {
          await refetchRound(roundId, "stale");
          // 取り直しの間に時計を作り直した(閉じた、開き直した)ときは、新しい時計の試行番号を進めない。
          if (staleTokens.get(roundId) !== token) return;
          attempts.set(roundId, (attempts.get(roundId) ?? 0) + 1);
          if (needOf(roundId)?.reason === "stale") scheduleStale(roundId);
        })();
      },
    );
    staleTimers.set(roundId, cancel);
  }

  // 開く依頼は、依頼の番号が増えたときだけ、依頼ごとにすぐ実行を始める(取り直しの実行中でも、前の開く依頼の実行中でも並行して始める)。
  function startOpenRun(need: {
    roundId: string;
    reason: RefreshReason;
    openRequest?: number;
  }) {
    const request = need.openRequest ?? 0;
    if (
      need.reason !== "open" ||
      request <= (startedOpen.get(need.roundId) ?? 0)
    ) {
      return;
    }
    startedOpen.set(need.roundId, request);
    void openRun(need.roundId);
  }

  // 主の理由が stale のときに添えられた理由のうち、diverged と overlay。
  function extrasOf(need: {
    reason: RefreshReason;
    reasons: readonly RefreshReason[];
  }): ReadonlySet<RefreshReason> {
    // 主の理由が stale のときだけ数える(それ以外は、主の理由の扱いに任せる)。
    if (need.reason !== "stale") return new Set();
    return new Set(
      need.reasons.filter((r) => r === "diverged" || r === "overlay"),
    );
  }

  // 主の理由が stale の間に、効かなかった結果(diverged)や重ねられなかった操作(overlay)が加わったら、時計とは別にすぐ取り直す。
  // 時計と試行の番号は、止めず、進めない。diverged は通知ごとに、overlay は新しく当たったときだけ求める。
  function requestExtraRefetch(
    need: {
      roundId: string;
      reason: RefreshReason;
      reasons: readonly RefreshReason[];
    },
    offline: boolean,
  ) {
    if (need.reason !== "stale") return;
    if (need.reasons.includes("diverged")) {
      if (shouldRefetch(NOT_OPEN_REQUEST, offline)) {
        void refetchRound(need.roundId, "diverged");
      }
      return;
    }
    const isNewOverlay =
      need.reasons.includes("overlay") &&
      !lastExtras.get(need.roundId)?.has("overlay");
    if (isNewOverlay && shouldRefetch(NOT_OPEN_REQUEST, offline)) {
      void refetchRound(need.roundId, "overlay");
    }
  }

  // 依頼と記録の変化から、取り直しの要否を見直す。
  function evaluate() {
    if (!active) return;
    const needs = refresh.refreshNeeds();
    if (needs.list && needs.listRequest > startedList) {
      startedList = needs.listRequest;
      void listRun();
    }
    const offline = connectivity.isOffline();
    for (const need of needs.rounds) {
      startOpenRun(need);
      // 効かなかった結果は通知ごとに取り直す(実行中に届いたものは完了後に1回やり直す)。印は取り直しの開始で消えるため、繰り返さない。
      if (isNewNeed(need)) applyNeed(need, offline);
      requestExtraRefetch(need, offline);
    }
    // 今回の要否を、次の見直しの比べる元にする(要否に無いラウンドは除く)。
    lastReasons.clear();
    lastExtras.clear();
    for (const need of needs.rounds) {
      lastReasons.set(need.roundId, need.reason);
      lastExtras.set(need.roundId, extrasOf(need));
    }
    cancelStaleExcept(
      new Set(
        needs.rounds
          .filter((need) => need.reason === "stale")
          .map((need) => need.roundId),
      ),
    );
  }

  // 新しく要る(または理由が変わった)か。効かなかった結果は、通知ごとに新しいとする。
  function isNewNeed(need: {
    roundId: string;
    reason: RefreshReason;
  }): boolean {
    return (
      need.reason === "diverged" ||
      lastReasons.get(need.roundId) !== need.reason
    );
  }

  // 端末のベースで開いたままの詳細は時計で取り直し、他の理由はすぐに取り直す。
  function applyNeed(
    need: { roundId: string; reason: RefreshReason },
    offline: boolean,
  ) {
    if (need.reason === "open") return;
    if (need.reason === "stale") {
      if (!staleTimers.has(need.roundId)) scheduleStale(need.roundId);
    } else if (shouldRefetch(NOT_OPEN_REQUEST, offline)) {
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
    for (const need of refresh.refreshNeeds().rounds) {
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
      control.start(userId);
      stopNeeds = refresh.onRefreshNeeds(evaluate);
      evaluate();
    },
    stop() {
      active = false;
      epoch += 1;
      stopNeeds?.();
      stopNeeds = undefined;
      for (const roundId of [...staleTimers.keys()]) cancelStale(roundId);
      residentGate = IDLE_GATE;
      startedList = 0;
      startedOpen.clear();
      attempts.clear();
      staleTokens.clear();
      refetchLane.gates.clear();
      refetchLane.reruns.clear();
      lastReasons.clear();
      lastExtras.clear();
      control.stop();
      refresh.reset();
    },
    // 利用者を切り替える。送信の状態を捨て、新しい利用者の記録を読み直す。
    switchUser(userId: string | null) {
      control.setUser(userId);
    },
    matchUser: (userId: string | null) => control.matchUser(userId),
    // 保留を戻して送る。
    resume() {
      control.resumeSending();
    },
    refreshAll(_cause: "resident") {
      requestResident();
    },
    online() {
      control.recoverOnline();
      requestResident();
      restartStale();
    },
    offline() {
      for (const roundId of [...staleTimers.keys()]) cancelStale(roundId);
    },
    visible() {
      requestResident();
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

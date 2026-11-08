import type { SessionReader, SignInChange } from "@/features/auth";
import type {
  RoundRecordControl,
  RoundRefreshControl,
} from "@/features/rounds";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  beginFlight,
  endFlight,
  type FlightGate,
  IDLE_GATE,
} from "../domain/flight-gate";
import { shouldRefetch } from "../domain/sync-trigger";

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

// いつ送り、いつ取り直すかを決める唯一の手続き。契機(開始、通信の復帰、見える状態)と、画面の依頼を受けて、記録の制御と取り直しの制御を動かす。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 可変の状態を閉じ込めるファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すかクラスへ書き換えることになり、責務は分かれず追いにくくなる。
export function createRoundSync(deps: {
  control: RoundRecordControl;
  refresh: RoundRefreshControl;
  session: Pick<SessionReader, "readSession">;
  connectivity: Connectivity;
}) {
  const { control, refresh, session, connectivity } = deps;
  let active = false;
  // 開始と停止のたびに進める。停止をまたぐ古い処理が、新しい状態を変えないため。
  let epoch = 0;
  // 同時に1回までの扉は、常駐の一括の取得と、ラウンドごとの取り直しの2種類だけに置く。ラウンドごとの開く依頼は、依頼の番号ごとに扉なしで並行して実行する。
  let residentGate: FlightGate = IDLE_GATE;
  // ラウンドごとの、最後に実行を始めた開く依頼の番号。同じ番号のあいだは、記録の知らせが何度届いても、実行を重ねない。
  const startedOpen = new Map<string, number>();
  const refetchLane: RoundLane = { gates: new Map(), reruns: new Map() };
  // 前回の見直しで要ると判断した理由。新しく要る(または理由が変わった)ときだけ取り直しを始める。
  const lastReasons = new Map<string, RefreshReason>();
  let stopNeeds: (() => void) | undefined;

  // 常駐の前段。サインイン済みで、記録の利用者と同じときだけ通る。
  async function residentPass(): Promise<boolean> {
    const reading = await session.readSession();
    return (
      reading.status === "authenticated" &&
      control.matchUser(reading.userId) === "same"
    );
  }

  // 常駐の扉の1回。前段を通ったときだけ取得して反映する。
  async function residentOnce(target: number) {
    const residentAllowed = await residentPass();
    if (epoch !== target) return;
    if (residentAllowed) await refresh.refreshAll();
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
  async function runResident() {
    const target = epoch;
    let again = true;
    while (again) {
      try {
        await residentOnce(target);
      } catch {
        // 取得の失敗は何もしない(次の契機で取り直す)。
      }
      // 停止をまたいだ処理は、新しい状態(扉と予約)に触れない。
      if (epoch !== target) return;
      const end = endFlight(residentGate);
      residentGate = end.gate;
      again = end.again;
    }
  }

  function requestResident() {
    const begin = beginFlight(residentGate);
    residentGate = begin.gate;
    if (begin.run) void runResident();
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

  // 依頼と記録の変化から、取り直しの要否を見直す。
  function evaluate() {
    if (!active) return;
    const needs = refresh.refreshNeeds();
    const offline = connectivity.isOffline();
    for (const need of needs.rounds) {
      startOpenRun(need);
      // 効かなかった結果は通知ごとに取り直す(実行中に届いたものは完了後に1回やり直す)。印は取り直しの開始で消えるため、繰り返さない。
      if (isNewNeed(need)) applyNeed(need, offline);
    }
    // 今回の要否を、次の見直しの比べる元にする(要否に無いラウンドは除く)。
    lastReasons.clear();
    for (const need of needs.rounds) lastReasons.set(need.roundId, need.reason);
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

  // 開く依頼は依頼ごとに別に実行する。他の理由(diverged、overlay)は、オフラインでなければすぐに取り直す。
  function applyNeed(
    need: { roundId: string; reason: RefreshReason },
    offline: boolean,
  ) {
    if (need.reason === "open") return;
    if (shouldRefetch(NOT_OPEN_REQUEST, offline)) {
      void refetchRound(need.roundId, need.reason);
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
      // 起動時の常駐の取得は、サインインの通知を待たずにここで1回頼む。前段が、未認証と別の利用者を除く。
      requestResident();
    },
    stop() {
      active = false;
      epoch += 1;
      stopNeeds?.();
      stopNeeds = undefined;
      residentGate = IDLE_GATE;
      startedOpen.clear();
      refetchLane.gates.clear();
      refetchLane.reruns.clear();
      lastReasons.clear();
      control.stop();
      refresh.reset();
    },
    // サインインの変化を、記録の制御へ渡す。反応(保留の再開)はラウンドが決める。
    signInChanged(change: SignInChange) {
      control.signInChanged(change);
    },
    // 通信の復帰と画面が見える状態。常駐の一括の取得を頼む。
    resume() {
      requestResident();
    },
  };
}

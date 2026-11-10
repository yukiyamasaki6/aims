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
  // 同時に1回までの扉は、常駐の一括の取得と、ラウンドごとの取り直しの2種類だけに置く。ラウンドごとの開く依頼は、依頼の番号ごとに扉なしで並行して実行する。
  let residentGate: FlightGate = IDLE_GATE;
  // ラウンドごとの、最後に実行を始めた開く依頼の番号。同じ番号のあいだは、記録の知らせが何度届いても、実行を重ねない。
  const startedOpen = new Map<string, number>();
  // ラウンドごとの取り直しの扉と、完了後にやり直す予約(ラウンドのIDの集合)。
  const refetchGates = new Map<string, FlightGate>();
  // 前回の見直しで、重ねられなかった確定済みの操作(overlay)が当たっていた、開く依頼のないラウンド。新しく当たったときだけ取り直す。
  let lastOverlay = new Set<string>();
  // 前回の見直しで、的が足りない印が付いていたか。付いていない状態から付いた状態に変わったときだけ、再取得を促す。
  let lastFacesWanted = false;

  // 常駐の前段。サインイン済みで、記録の利用者と同じときだけ通る。
  async function residentPass(): Promise<boolean> {
    const reading = await session.readSession();
    return (
      reading.status === "authenticated" && control.isRecordUser(reading.userId)
    );
  }

  // 常駐の扉で一括の取得を行う。実行中の契機は、完了後に1回だけやり直す。
  async function runResident() {
    let again = true;
    while (again) {
      if (await residentPass()) await refresh.refreshAll();
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

  // 予約した取り直しを行うか。詳細を閉じた(取り直しが要らなくなった)後は行わない。
  // 要否の理由が開く依頼でなく、オフラインでないときだけ(開く依頼は、依頼ごとに別に実行する)。
  function shouldRerun(roundId: string): boolean {
    const need = refresh
      .refreshNeeds()
      .rounds.find((entry) => entry.roundId === roundId);
    return need !== undefined && !need.open && !connectivity.isOffline();
  }

  // 取り直しの1回が終わった。続けて行うなら真を返し、行わないなら扉を空にする。
  function finishRun(roundId: string): boolean {
    const end = endFlight(refetchGates.get(roundId) ?? IDLE_GATE);
    refetchGates.set(roundId, end.gate);
    if (end.again && shouldRerun(roundId)) return true;
    refetchGates.set(roundId, IDLE_GATE);
    return false;
  }

  // 1つのラウンドの取り直しを、同時に1回までにする。実行中に届いた知らせは、完了後にもう1度行う。
  async function refetchRound(roundId: string) {
    const begin = beginFlight(refetchGates.get(roundId) ?? IDLE_GATE);
    refetchGates.set(roundId, begin.gate);
    if (!begin.run) return;
    let again = true;
    while (again) {
      await refresh.refreshRound(roundId);
      again = finishRun(roundId);
    }
  }

  // 開く依頼は、依頼の番号が増えたときだけ、依頼ごとにすぐ実行を始める(取り直しの実行中でも、前の開く依頼の実行中でも並行して始める)。
  function startOpenRun(need: { roundId: string; openRequest: number }) {
    if (need.openRequest <= (startedOpen.get(need.roundId) ?? 0)) return;
    startedOpen.set(need.roundId, need.openRequest);
    void refresh.refreshRound(need.roundId);
  }

  // 的が足りない印が付いたとき、オンラインで、常駐の取得が実行中でなければ、常駐の取得を頼む。実行中の取得が的を保存する。
  function promptFacesFetch() {
    const wanted = refresh.facesWanted();
    const rising = wanted && !lastFacesWanted;
    lastFacesWanted = wanted;
    if (rising && !connectivity.isOffline() && !residentGate.running) {
      requestResident();
    }
  }

  // 依頼と記録の変化から、取り直しの要否を見直す。
  // 開く依頼がある間は、他の取り直しを出さない。効かなかった結果(diverged)は通知ごとに(オフラインでなければ)取り直す。
  // 重ねられなかった操作(overlay)は新しく当たったときだけ取り直す。どちらも当たるときは、取り直しは1回で足りる。
  function evaluate() {
    promptFacesFetch();
    const nextOverlay = new Set<string>();
    const online = !connectivity.isOffline();
    for (const need of refresh.refreshNeeds().rounds) {
      if (need.open) {
        startOpenRun(need);
        continue;
      }
      if (need.overlay) nextOverlay.add(need.roundId);
      const isNewOverlay = need.overlay && !lastOverlay.has(need.roundId);
      if (online && (need.diverged || isNewOverlay)) {
        void refetchRound(need.roundId);
      }
    }
    lastOverlay = nextOverlay;
  }

  return {
    start(userId: string | null) {
      control.start(userId);
      refresh.onRefreshNeeds(evaluate);
      // 起動時の常駐の取得は、サインインの通知を待たずにここで1回頼む。前段が、未認証と別の利用者を除く。
      requestResident();
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

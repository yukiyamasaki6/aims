import type { SessionReader } from "@/features/auth";
import type { Clock } from "@/lib/clock/contract/clock";
import type { PageNavigation } from "@/lib/page-navigation/contract/page-navigation";
import { roundPath } from "@/routes";
import type { SignInFailure } from "../domain/fetch-status";
import { FALLBACK_WAIT_MS } from "../domain/fetch-wait";
import type { Preset } from "../domain/preset";
import { type RoundCreated, roundCreatedDraftOf } from "../domain/round-start";
import { roundStreamId } from "../domain/sync-events";
import type { RoundRecordHub } from "./round-record-hub";
import { TIMED_OUT, withinTime } from "./time-limit";
import type { UniqueIds } from "./unique-ids";

// 開始できなかった理由。left: 認証の確認を待つ間に、結果を受け取る画面が無くなった。
type StartFailure = SignInFailure | "left";

// created: 作成を端末の操作の列へ保存した。保存の待ちの間に画面を離れたときは、詳細の画面へは進まない。
// failed: 開始できず、失敗の種類がある。
type RoundStartResult =
  | { status: "created"; roundId: string }
  | { status: "failed"; error: StartFailure };

export type RoundStart = {
  startRound(
    preset: Preset | null,
    isCurrent: () => boolean,
  ): Promise<RoundStartResult>;
};

// 選択したプリセット(無ければnull)でラウンドを開始する。端末への保存の完了だけを待ち、送信を待たずに詳細の画面へ進む。
// 認証の確認で待つのは失効時だけで、上限はFALLBACK_WAIT_MS。時間切れは、確認できない(不明)として扱う。未認証と確認できたときだけ止め、不明のときは開始する(送信は認証が回復するまで待つ)。
// 認証の確認の待ちの後に画面が無くなったときは、追記も遷移もしない。追記の保存の待ちの後に画面が無くなったときは、遷移だけしない(離れた後の強制遷移を防ぐ)。副作用が手続きの中の待ちの後にあるため、結果ではなく呼び出し側の`isCurrent`で守る。
// 例外: 拒否しない(認証の読み取りと保存の試みは拒否しない)。
export function createRoundStart(deps: {
  hub: Pick<RoundRecordHub, "append">;
  sessionReader: SessionReader;
  ids: Pick<UniqueIds, "next">;
  clock: Clock;
  pageNavigation: Pick<PageNavigation, "go">;
}): RoundStart {
  const { hub, sessionReader, ids, clock, pageNavigation } = deps;

  return {
    async startRound(preset, isCurrent) {
      const reading = await withinTime(
        clock,
        sessionReader.readSession(),
        FALLBACK_WAIT_MS,
      );
      if (!isCurrent()) return { status: "failed", error: "left" };
      if (reading !== TIMED_OUT && reading.status === "unauthenticated") {
        return { status: "failed", error: "unauthenticated" };
      }

      // IDはどれも新しい値で、振る順は意味を持たない。
      const draft = roundCreatedDraftOf(
        preset,
        clock.now(),
        clock.utcOffsetMinutes(),
      );
      const operation: RoundCreated = {
        ...draft,
        eventId: ids.next(),
        roundId: ids.next(),
        distances: draft.distances.map((d) => ({
          ...d,
          eventId: ids.next(),
          id: ids.next(),
        })),
      };
      await hub.append(roundStreamId(operation.roundId), operation);
      if (isCurrent()) pageNavigation.go(roundPath(operation.roundId));
      return { status: "created", roundId: operation.roundId };
    },
  };
}

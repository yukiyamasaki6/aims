import type { Clock } from "@/lib/clock/contract/clock";
import type { PageNavigation } from "@/lib/page-navigation/contract/page-navigation";
import { FALLBACK_WAIT_MS } from "../domain/fetch-result";
import type { Preset } from "../domain/preset";
import { roundPath } from "../domain/round-routes";
import { type RoundCreated, roundCreatedDraftOf } from "../domain/round-start";
import { roundStreamId } from "../domain/sync-events";
import type { RoundRecordHub } from "./round-record-hub";
import type { SignInReader } from "./sign-in-reader";
import { TIMED_OUT, withinTime } from "./time-limit";
import type { UniqueIds } from "./unique-ids";

// created: 作成を端末の操作の列へ保存し、詳細の画面へ進んだ。
// failed: 開始できず、画面に出す文言がある。
// discarded: 認証の確認を待つ間に、結果を受け取る画面が無くなった。
export type StartRoundResult =
  | { status: "created"; roundId: string }
  | { status: "failed"; error: string }
  | { status: "discarded" };

export type RoundStart = {
  startRound(
    preset: Preset | null,
    isCurrent: () => boolean,
  ): Promise<StartRoundResult>;
};

// 選択したプリセット(無ければnull)でラウンドを開始する。端末への保存の完了だけを待ち、送信を待たずに詳細の画面へ進む。
// 認証の確認で待つのは失効時だけで、上限はFALLBACK_WAIT_MS。時間切れは、確認できない(不明)として扱う。未認証と確認できたときだけ止め、不明のときは開始する(送信は認証が回復するまで待つ)。
// 例外: 遷移が投げたときだけ、その例外で拒否する。保存が済んでいて、失敗として戻すと再び実行でき、成功として返すと遷移の失敗を隠すため、拒否として伝える。認証の読み取りと保存の試みは拒否しない。
export function createRoundStart(deps: {
  hub: Pick<RoundRecordHub, "append">;
  signIn: SignInReader;
  ids: Pick<UniqueIds, "next">;
  clock: Clock;
  pageNavigation: Pick<PageNavigation, "go">;
}): RoundStart {
  const { hub, signIn, ids, clock, pageNavigation } = deps;

  return {
    async startRound(preset, isCurrent) {
      const reading = await withinTime(clock, signIn.read(), FALLBACK_WAIT_MS);
      if (!isCurrent()) return { status: "discarded" };
      if (reading !== TIMED_OUT && reading.status === "unauthenticated") {
        return { status: "failed", error: reading.message };
      }

      // IDはどれも新しい値で、振る順は意味を持たない。
      const draft = roundCreatedDraftOf(preset, clock.now());
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
      pageNavigation.go(roundPath(operation.roundId));
      return { status: "created", roundId: operation.roundId };
    },
  };
}

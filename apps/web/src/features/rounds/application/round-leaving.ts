import type { PageNavigation } from "@/lib/page-navigation/contract/page-navigation";
import { ROUNDS_HOME_PATH } from "@/routes";
import { statusOperation } from "../domain/round-progress";
import { originPathOf, type RoundOrigin } from "../domain/round-routes";
import { roundStreamId } from "../domain/sync-events";
import type { RoundDeletion } from "./round-deletion";
import type { RoundRecordHub } from "./round-record-hub";
import type { UniqueIds } from "./unique-ids";

export type RoundLeaving = {
  // 入力を完了にする。保存の完了の後、画面が残っている(`isCurrent`)ときだけホームへ進む。送信の完了は待たない。
  completeRound(roundId: string, isCurrent: () => boolean): Promise<void>;
  // 削除を積み(RoundDeletion.deleteRound)、その完了の後、画面が残っている(`isCurrent`)ときだけ遷移元(`origin`。ホームまたは履歴)へ置き換えて移る。送信の完了は待たない。
  deleteRoundAndLeave(
    roundId: string,
    origin: RoundOrigin,
    isCurrent: () => boolean,
  ): Promise<void>;
};

// 詳細の画面から離れる手続き。保存の後に遷移する順序をここに置き、画面は遷移の実装を持たない。
// 保存の完了を待つ間に画面を離れたときは、追記は済んでいるが遷移しない(離れた後の強制遷移を防ぐ)。画面が残っているかは呼び出し側の`isCurrent`で問う。
export function createRoundLeaving(deps: {
  hub: Pick<RoundRecordHub, "append">;
  ids: Pick<UniqueIds, "next">;
  pageNavigation: PageNavigation;
  deletion: RoundDeletion;
}): RoundLeaving {
  const { hub, ids, pageNavigation, deletion } = deps;

  return {
    async completeRound(roundId, isCurrent) {
      await hub.append(
        roundStreamId(roundId),
        statusOperation(roundId, "completed", ids.next()),
      );
      if (!isCurrent()) return;
      pageNavigation.go(ROUNDS_HOME_PATH);
    },
    async deleteRoundAndLeave(roundId, origin, isCurrent) {
      await deletion.deleteRound(roundId);
      if (!isCurrent()) return;
      pageNavigation.replace(originPathOf(origin));
    },
  };
}

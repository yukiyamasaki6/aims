import { statusOperation } from "../domain/round-progress";
import { ROUNDS_PATH } from "../domain/round-routes";
import { roundStreamId } from "../domain/sync-events";
import type { RoundDeletion } from "./delete-round";
import type { Navigation } from "./navigation";
import type { RoundRecordHub } from "./round-record-hub";
import type { UniqueIds } from "./unique-ids";

export type RoundLeaving = {
  // 入力を完了にする。保存の完了の後に一覧へ進む。送信の完了は待たない。
  completeRound(roundId: string): Promise<void>;
  // 削除を積み(RoundDeletion.deleteRound)、その完了の後に一覧へ置き換えて移る。送信の完了は待たない。
  deleteRoundAndLeave(roundId: string): Promise<void>;
  // 一覧へ置き換えて移る。
  leaveRound(): void;
};

// 詳細の画面から離れる手続き。保存の後に遷移する順序をここに置き、画面は遷移の実装を持たない。
// 例外: hub.appendは保存の試みが終われば解決し拒否しない。遷移が投げたときだけ、その例外で拒否する(Navigationの注記)。
export function createRoundLeaving(deps: {
  hub: Pick<RoundRecordHub, "append">;
  ids: Pick<UniqueIds, "next">;
  navigation: Navigation;
  deletion: RoundDeletion;
}): RoundLeaving {
  const { hub, ids, navigation, deletion } = deps;

  return {
    async completeRound(roundId) {
      await hub.append(
        roundStreamId(roundId),
        statusOperation(roundId, "completed", ids.next()),
      );
      navigation.go(ROUNDS_PATH);
    },
    async deleteRoundAndLeave(roundId) {
      await deletion.deleteRound(roundId);
      navigation.replace(ROUNDS_PATH);
    },
    leaveRound() {
      navigation.replace(ROUNDS_PATH);
    },
  };
}

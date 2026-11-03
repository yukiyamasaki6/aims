import { roundDisabledOperation } from "../domain/round-progress";
import { roundStreamId } from "../domain/sync-events";
import type { RoundRecordHub } from "./round-record-hub";
import type { UniqueIds } from "./unique-ids";

export type RoundDeletion = {
  // 削除を積む(離れない。画面に残る)。保存の試みが終わると解決し、保存に失敗しても拒否しない。送信の完了は待たない。
  deleteRound(roundId: string): Promise<void>;
};

// ラウンドの削除の手続き。削除の操作の組み立てをここに置く。
export function createRoundDeletion(deps: {
  hub: Pick<RoundRecordHub, "append">;
  ids: Pick<UniqueIds, "next">;
}): RoundDeletion {
  const { hub, ids } = deps;
  return {
    deleteRound: (roundId) =>
      hub.append(
        roundStreamId(roundId),
        roundDisabledOperation(roundId, ids.next()),
      ),
  };
}

import {
  isOlderBase,
  type RecordBase,
  type ReflectableEntry,
  type RoundBaseRecord,
  reflectsBase,
} from "./round-base";
import { applyOperations } from "./round-op-apply";
import { type RoundState, selectRoundState } from "./round-tables";
import { hasRoundDeletion, type SyncOperation } from "./sync-events";

// 入力中と見せるか。状態が入力中かだけで決め、矢数に達していないエンドの有無や記録日では決めない。
export function isRoundInProgress(
  state: Pick<RoundState, "status" | "roundDisabled">,
): boolean {
  return !state.roundDisabled && state.status === "in_progress";
}

// オフラインで開けるよう端末に保持するか。ベースに操作を重ねた状態が入力中か、ベースに反映されていない操作が残るものを保持する。
// ベースに反映されていない操作は、未確定(未送信)の操作と、確定済みで取得に未反映の操作。
// ベースが知らない確定済みの操作が残る間に組を消すと、後から届いた古い取得で古い状態に戻るため保持する。
// 表示の規則(`isRoundInProgress`)とは別で、保持して入力中と見せないラウンドがある。
export function keepsRoundBase(
  base: RoundBaseRecord,
  entries: ReflectableEntry[],
): boolean {
  const applied = entries
    .filter((entry) => entry.ackedApplied !== false)
    .map((entry) => ({
      operation: entry.operation,
      confirmedFields:
        entry.ackedRevision === undefined
          ? undefined
          : (entry.ackedFields ?? null),
    }));
  // 保持の判定に的は要らない(状態の`status`と削除だけを使う)。
  const state = selectRoundState(applyOperations(base.tables, applied, []));
  return (
    isRoundInProgress(state) ||
    entries.some((entry) => !reflectsBase(base, entry))
  );
}

// 端末の保存が使う、ベースと保持の規則。形は保存の`StreamRules`に構造で合う。
export const roundStreamRules = {
  reflects: reflectsBase,
  keeps: keepsRoundBase,
  isOlder: isOlderBase,
};

// 取得して端末の記録へ反映する対象にするか。削除されておらず、作成が確定していて、ベースか操作を持つもの。
// 確定していない作成は、サーバーにまだ無い。取得で返らなくても削除と扱わない。
export function isRetainedForRefresh(group: {
  base: RecordBase | undefined;
  entries: readonly { operation: SyncOperation; ackedRevision?: number }[];
}): boolean {
  if (hasRoundDeletion(group.entries.map((entry) => entry.operation))) {
    return false;
  }
  const unconfirmedCreation = group.entries.some(
    (entry) =>
      entry.operation.type === "round.created" &&
      entry.ackedRevision === undefined,
  );
  if (unconfirmedCreation) return false;
  return Boolean(group.base?.base) || group.entries.length > 0;
}

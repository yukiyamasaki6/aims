import type { RecordBase } from "./round-base";
import { roundStreamRules } from "./round-retention";
import type { RoundTables } from "./round-tables";
import { hasRoundDeletion, type SyncOperation } from "./sync-events";
import type { TargetFaceOption } from "./target-face";

type CreatedOperation = Extract<SyncOperation, { type: "round.created" }>;

type OpenGroup = {
  base: RecordBase | undefined;
  entries: readonly {
    operation: SyncOperation;
    ackedRevision?: number;
    ackedApplied?: boolean;
    ackedFields?: string[];
  }[];
};

// 詳細を開くときの判断。
// 削除は、取得せずに離れる(削除以降の操作は反映されないため、取得した状態を表示する意味がない)。
// 確定していない作成があれば、ラウンドは取得せずに作成の操作を基準にする(作成の後続は確定まで送られないため、サーバーの状態は作成の操作と一致する)。
export type OpenPlan =
  | { kind: "deleted" }
  | { kind: "creation"; operation: CreatedOperation }
  | { kind: "fetch" };

export function openPlan(group: OpenGroup): OpenPlan {
  if (hasRoundDeletion(group.entries.map((entry) => entry.operation))) {
    return { kind: "deleted" };
  }
  for (const entry of group.entries) {
    const { operation } = entry;
    if (operation.type !== "round.created") continue;
    if (entry.ackedRevision !== undefined) continue;
    return { kind: "creation", operation };
  }
  return { kind: "fetch" };
}

// 端末のベースで開くための材料。的の一覧の保存分が無いとき、端末のベースが保持の規則に当たらないときはnull。
export type LocalOpening = {
  base: RoundTables;
  targetFaces: TargetFaceOption[];
};

export function localOpening(
  group: OpenGroup,
  savedFaces: TargetFaceOption[] | null,
): LocalOpening | null {
  const stored = group.base?.base;
  if (!stored) return null;
  if (!roundStreamRules.keeps(stored, [...group.entries])) return null;
  if (savedFaces === null) return null;
  return { base: stored.tables, targetFaces: savedFaces };
}

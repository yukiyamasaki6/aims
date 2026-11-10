import type { RecordBase } from "./round-base";
import type { AppliedOperation } from "./round-op-apply";
import type { RoundTables } from "./round-tables";
import { hasRoundDeletion, type SyncOperation } from "./sync-events";
import type { TargetFaceOption } from "./target-face";

type CreatedOperation = Extract<SyncOperation, { type: "round.created" }>;

type OpenGroup = {
  base: RecordBase | undefined;
  operations: readonly AppliedOperation[];
};

// 詳細を開くときの判断。
// 削除は、取得せずに見つからないものとして返す(削除以降の操作は反映されないため、取得した状態を表示する意味がない)。
// 確定していない作成があれば、ラウンドは取得せずに作成の操作を基準にする(作成の後続は確定まで送られないため、サーバーの状態は作成の操作と一致する)。
export type OpenPlan =
  | { kind: "deleted" }
  | { kind: "creation"; operation: CreatedOperation }
  | { kind: "fetch" };

export function openPlan(group: OpenGroup): OpenPlan {
  if (hasRoundDeletion(group.operations.map((entry) => entry.operation))) {
    return { kind: "deleted" };
  }
  for (const entry of group.operations) {
    const { operation } = entry;
    if (operation.type !== "round.created") continue;
    if (entry.confirmedFields !== undefined) continue;
    return { kind: "creation", operation };
  }
  return { kind: "fetch" };
}

// 端末のベースで開くための材料。端末のベースが無い(削除の印を含む)とき、的の一覧の保存分が無いときはnull。
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
  if (savedFaces === null) return null;
  return { base: stored.tables, targetFaces: savedFaces };
}

// サーバーに無いか。記録にベースが無く(`undefined`)、起点が確定していない作成の操作だけである。
// 未確定の作成だけが起点のラウンドは、取得で返らなくても削除と扱わない。操作もベースも無い記録(端末に一度も無いID)は、サーバーに無いと判断しない。
export function isUnknownToServer(record: {
  base: RecordBase | undefined;
  items: readonly { operation: SyncOperation; ackedRevision?: number }[];
}): boolean {
  if (record.base !== undefined) return false;
  return record.items.some(
    (item) =>
      item.operation.type === "round.created" &&
      item.ackedRevision === undefined,
  );
}

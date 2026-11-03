import type { RecordBase } from "./round-base";
import {
  type AppliedOperation,
  applyOperations,
  deriveTables,
} from "./round-op-apply";
import { roundStreamRules } from "./round-retention";
import {
  type RoundState,
  type RoundTables,
  roundTablesFromCreated,
  selectRoundState,
} from "./round-tables";
import type { ScoringTargetFace } from "./scorecard-scoring";
import { hasRoundDeletion, type SyncOperation } from "./sync-events";
import type { TargetFaceOption } from "./target-face";

type CreatedOperation = Extract<SyncOperation, { type: "round.created" }>;

// 端末の組から、画面と同じ導出で状態を求める。ベースが無いときは作成の操作が表す状態を基準にする。
// 削除の印のとき、または基準がないときはnull。
export function deriveRoundState(
  base: RecordBase | undefined,
  operations: readonly AppliedOperation[],
  faces: ScoringTargetFace[],
): RoundState | null {
  if (base?.base === null) return null;
  let tables: RoundTables | undefined = base?.base?.tables;
  if (!tables) {
    const created = operations.find(
      (applied) => applied.operation.type === "round.created",
    )?.operation;
    if (created?.type !== "round.created") return null;
    tables = roundTablesFromCreated(created);
  }
  return selectRoundState(applyOperations(tables, [...operations], faces));
}

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

// 開いた詳細の、記録から求めた画面の状態。
export function roundScreenState(
  record: {
    base: RecordBase | undefined;
    operations: readonly AppliedOperation[];
  },
  loadedBase: RoundTables,
  faces: ScoringTargetFace[],
): {
  state: RoundState;
  tables: RoundTables;
  needsRefetch: boolean;
  deletedElsewhere: boolean;
} {
  // 組にベースが無いのは、作成が未確定の間だけ(最初のベースは作成の操作が表す)。削除の印のときも、一覧へ戻るまでの間は最初のベースで描く。
  const base = record.base?.base?.tables ?? loadedBase;
  const derived = deriveTables(base, [...record.operations], faces);
  return {
    state: selectRoundState(derived.tables),
    tables: derived.tables,
    needsRefetch: derived.refetch,
    deletedElsewhere: record.base?.base === null,
  };
}

// 確定していない作成の操作が、確定を見ずに記録から消えたかの判定。消えたとき(破棄された、または反映を確かめて外した)gone。
export type CreationProgress = {
  seen: boolean;
  confirmed: boolean;
  gone: boolean;
};

export function creationProgress(
  previous: CreationProgress,
  items: readonly { eventId: string; ackedRevision?: number }[],
  creationEventId: string,
): CreationProgress {
  if (previous.gone) return previous;
  const item = items.find((entry) => entry.eventId === creationEventId);
  if (item) {
    return {
      seen: true,
      confirmed: previous.confirmed || item.ackedRevision !== undefined,
      gone: false,
    };
  }
  return { ...previous, gone: previous.seen && !previous.confirmed };
}

export const INITIAL_CREATION: CreationProgress = {
  seen: false,
  confirmed: false,
  gone: false,
};

export type RefreshReason = "open" | "stale" | "diverged" | "overlay";

// 開いている詳細ごとの、ベースを取り直す要否と理由。先に当たる理由を1つ返す。
export function freshBaseNeeds(
  watches: readonly {
    roundId: string;
    opening: boolean;
    stale: boolean;
  }[],
  flags: ReadonlyMap<string, { diverged: boolean; overlay: boolean }>,
): { roundId: string; reason: RefreshReason; reasons: RefreshReason[] }[] {
  const needs: {
    roundId: string;
    reason: RefreshReason;
    reasons: RefreshReason[];
  }[] = [];
  for (const watch of watches) {
    const flag = flags.get(watch.roundId);
    // 当たる全ての理由を、open、stale、diverged、overlay の順に並べる。主の理由は先頭。
    const reasons: RefreshReason[] = [];
    if (watch.opening) reasons.push("open");
    if (watch.stale) reasons.push("stale");
    if (flag?.diverged) reasons.push("diverged");
    if (flag?.overlay) reasons.push("overlay");
    if (reasons.length > 0) {
      needs.push({ roundId: watch.roundId, reason: reasons[0], reasons });
    }
  }
  return needs;
}

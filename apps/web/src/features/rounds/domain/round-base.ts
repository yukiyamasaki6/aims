import type { RoundRevisions, RoundTables } from "./round-tables";

export type { RoundRevisions };

import type { SyncOperation } from "./sync-events";

// 取得して端末に持つ、ラウンドのベース。サーバーの状態と、その時点の対象ごとのrevision。
export type RoundBaseRecord = {
  tables: RoundTables;
  revisions: RoundRevisions;
};

// 取得の開始時刻を付けたベース。`base`がnullは、サーバーに無い(削除された)ことの印。
// 開始時刻は、古い取得の結果で新しい保存を上書きしないために使う。
export type RecordBase = { startedAt: number; base: RoundBaseRecord | null };

// 反映済みの判定が使う、列の1件の項目。
export type ReflectableEntry = {
  operation: SyncOperation;
  ackedRevision?: number;
  ackedApplied?: boolean;
  ackedFields?: string[];
};

// 操作の対象について、取得が持つrevision。取得に行が無ければ0。
// ラウンドの削除は、取得が「見つからない」になるため、確認する対象がない(undefined)。
function fetchedRevision(
  operation: SyncOperation,
  revisions: RoundRevisions,
): number | undefined {
  switch (operation.type) {
    case "round.created":
    case "round.updated":
      return revisions.round;
    case "round.disabled":
      return undefined;
    case "distance.created":
      return revisions.distances[operation.id] ?? 0;
    case "distance.updated":
    case "distance.disabled":
      return revisions.distances[operation.distanceId] ?? 0;
    case "shot.recorded":
    case "shot.cleared":
      return revisions.shots[operation.shotId] ?? 0;
  }
}

// 確定した操作が、ベースに反映済みか。確定のrevisionと取得のrevisionの比較で判定する。
// 時刻では、取得の間に確定した操作が取得の前後どちらで適用されたかを決められないため。
// 効かなかった操作は、どこにも記録されないため、反映済みとして扱う。削除の印(null)には、確定済みの操作は全て反映済み。
export function reflectsBase(
  base: RoundBaseRecord | null,
  entry: ReflectableEntry,
): boolean {
  if (entry.ackedRevision === undefined) return false;
  if (entry.ackedApplied === false || base === null) return true;
  const fetchedAt = fetchedRevision(entry.operation, base.revisions);
  return fetchedAt !== undefined && fetchedAt >= entry.ackedRevision;
}

// 取り込もうとするベースが、今のベースより古い状態か。
// 取得の開始時刻では、同時に始まった取得のどちらが新しい状態を返すかを決められないため、サーバーが付けたrevisionで比べる。
// 両方にある対象(ラウンド、同じIDの距離、同じIDの矢)のどれかで、取り込むほうのrevisionが小さければ古い。片方にしか無い対象は比べない。
export function isOlderBase(
  current: RoundBaseRecord,
  incoming: RoundBaseRecord,
): boolean {
  if (incoming.revisions.round < current.revisions.round) return true;
  const older = (
    now: Record<string, number>,
    next: Record<string, number>,
  ): boolean =>
    Object.entries(next).some(
      ([id, revision]) => id in now && revision < now[id],
    );
  return (
    older(current.revisions.distances, incoming.revisions.distances) ||
    older(current.revisions.shots, incoming.revisions.shots)
  );
}

// 取得の間に状態が変わって同じIDが重なったときは、revisionが大きい行を使い、同じなら先の行を使う。
export function newestById<T extends { id: string; revision: number }>(
  rows: readonly T[],
): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const current = merged.get(row.id);
    if (!current || row.revision > current.revision) merged.set(row.id, row);
  }
  return [...merged.values()];
}

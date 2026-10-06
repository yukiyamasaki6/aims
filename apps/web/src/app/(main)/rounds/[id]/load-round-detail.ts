import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocalIdentity } from "@/features/auth/local-identity";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { OpLogEntry } from "@/features/op-log/op-log-types";
import type { Database } from "@/types/supabase";
import type { TargetFaceOption } from "./distance-config-row";
import {
  fetchRoundDetail,
  type RoundRevisions,
  shotRevisionKey,
} from "./fetch-round-detail";
import { applyOperations } from "./round-op-apply";
import { roundOpStore, roundStreamId } from "./round-op-store";
import {
  type RoundTables,
  roundTablesFromCreated,
  roundTablesFromServer,
} from "./round-tables";
import { type SyncOperation, upgradeLegacyOperation } from "./sync-events";

export type LoadedRoundDetail = {
  // サーバーの状態。操作の列は重ねていない。
  base: RoundTables;
  // 基準へ重ねる列(`seq`順)。反映済みと確かめた操作を含まない。
  entries: OpLogEntry<SyncOperation>[];
  // 反映済みと確かめた操作のeventId。詳細画面の表示の開始時に列から外す。
  reflected: string[];
  targetFaces: TargetFaceOption[];
  // ラウンドの削除が列にあるため、一覧へ戻るか。
  leaveRound: boolean;
  // 確定していない作成のeventId。あるとき、基準は端末の作成の操作で、的は含まない(呼び出し側が取得する)。
  pendingCreationEventId: string | null;
};

// IndexedDBが使えなくても、サーバーの状態の表示は続ける。
async function loadEntries(
  roundId: string,
): Promise<OpLogEntry<SyncOperation>[]> {
  try {
    const stored = await roundOpStore.loadStream(
      roundStreamId(roundId),
      getLocalIdentity(),
    );
    return stored.map((entry) => ({
      ...entry,
      operation: upgradeLegacyOperation(entry.operation),
    }));
  } catch {
    return [];
  }
}

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
      return (
        revisions.shots[
          shotRevisionKey(
            operation.distanceId,
            operation.endNumber,
            operation.arrowNumber,
          )
        ] ?? 0
      );
  }
}

// 確定した操作が、取得の状態に反映済みか。
// 効かなかった操作は、どこにも記録されないため、反映済みとして扱う。
function isReflected(
  entry: OpLogEntry<SyncOperation>,
  revisions: RoundRevisions,
): boolean {
  if (entry.ackedRevision === undefined) return false;
  if (entry.ackedApplied === false) return true;
  const { operation } = entry;
  // 空のマスへの取り消しは、取得に行が無く、重ねても変わらない。
  if (
    operation.type === "shot.cleared" &&
    revisions.shots[
      shotRevisionKey(
        operation.distanceId,
        operation.endNumber,
        operation.arrowNumber,
      )
    ] === undefined
  ) {
    return true;
  }
  const fetchedAt = fetchedRevision(operation, revisions);
  return fetchedAt !== undefined && fetchedAt >= entry.ackedRevision;
}

// 取得の前後の列を合わせる。同じ操作は、確定のrevisionがある方を使う。
// 前にだけある操作は、別のタブが反映を確かめて列から外したもの。後にだけある操作は、読み取り後に積まれたもの。
function mergeEntries(
  before: OpLogEntry<SyncOperation>[],
  after: OpLogEntry<SyncOperation>[],
): OpLogEntry<SyncOperation>[] {
  const merged = new Map<string, OpLogEntry<SyncOperation>>();
  for (const entry of [...before, ...after]) {
    const existing = merged.get(entry.eventId);
    if (
      !existing ||
      (existing.ackedRevision === undefined &&
        entry.ackedRevision !== undefined)
    ) {
      merged.set(entry.eventId, entry);
    }
  }
  return [...merged.values()].sort((a, b) => a.seq - b.seq);
}

// サーバーの状態へ、端末の操作の列を重ねる材料を返す。
// 確定した操作は、サーバーが確定したrevisionと取得のrevisionの比較で、取得に反映済みかを判定する。
// 時刻では、取得の間に確定した操作が取得の前後どちらで適用されたかを決められないため。
export async function loadRoundDetail(
  supabase: SupabaseClient<Database>,
  roundId: string,
): Promise<FetchResult<LoadedRoundDetail>> {
  const first = await loadEntries(roundId);
  // 確定していない作成があれば、取得せずに作成の操作を基準にする。作成の後続は確定まで送られないため、サーバーの状態は作成の操作と一致する。
  for (const entry of first) {
    const { operation } = entry;
    if (operation.type !== "round.created") continue;
    if (entry.ackedRevision !== undefined) continue;
    const base = roundTablesFromCreated(operation);
    return {
      status: "ok",
      data: {
        base,
        entries: first,
        reflected: [],
        targetFaces: [],
        leaveRound: applyOperations(
          base,
          first.map((e) => ({
            operation: e.operation,
            confirmedFields: undefined,
          })),
          [],
        ).round.disabled,
        pendingCreationEventId: operation.eventId,
      },
    };
  }

  const beforePromise = Promise.resolve(first);
  const fetched = await fetchRoundDetail(supabase, roundId);
  if (fetched.status !== "ok") return fetched;

  const before = await beforePromise;
  const after = await loadEntries(roundId);
  const { revisions, roundConfig, distances, shots, targetFaces } =
    fetched.data;

  const entries: OpLogEntry<SyncOperation>[] = [];
  const reflected: string[] = [];
  for (const entry of mergeEntries(before, after)) {
    if (isReflected(entry, revisions)) {
      reflected.push(entry.eventId);
    } else {
      entries.push(entry);
    }
  }

  const base = roundTablesFromServer({ roundConfig, distances, shots });
  return {
    status: "ok",
    data: {
      base,
      entries,
      reflected,
      targetFaces,
      leaveRound: applyOperations(
        base,
        entries.map((entry) => ({
          operation: entry.operation,
          confirmedFields: undefined,
        })),
        targetFaces,
      ).round.disabled,
      pendingCreationEventId: null,
    },
  };
}

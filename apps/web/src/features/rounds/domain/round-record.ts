import {
  isOlderBase,
  type RecordBase,
  type RoundBaseRecord,
  reflectsBase,
} from "./round-base";
import type { AppliedOperation } from "./round-op-apply";
import type { SyncOperation } from "./sync-events";

// 1つのラウンドの端末の記録。ベースと操作の列のうち、画面が読む部分を、変更しない値と関数にしたもの。
// 送信の状態(送信中、リトライ待機、保留)は持たない(送る側が持つ)。
type RecordItem = {
  readonly eventId: string;
  readonly operation: SyncOperation;
  // 保存が終わった。
  readonly saved: boolean;
  readonly ackedRevision?: number;
  // 確定済みの結果。未確定ならundefined、全項目が効いたならnull、項目に分ける操作で一部だけ効いたなら効いた項目。
  readonly confirmedFields?: string[] | null;
};

export type RoundRecord = {
  readonly base: RecordBase | undefined;
  readonly items: readonly RecordItem[];
};

// 保存先の1行。保存先の型に依存しないよう、同じ形をここで宣言する。
type StoredRow = {
  eventId: string;
  ackedRevision?: number;
  ackedFields?: string[];
  operation: SyncOperation;
};

// 保存先の1つの列の組。
export type StoredGroup = {
  base: RecordBase | undefined;
  entries: readonly StoredRow[];
};

// 1つの列の、ベースと、保存の完了前を含む操作。
export type RecordSnapshot = {
  base: RecordBase | undefined;
  operations: readonly AppliedOperation[];
};

// 送信の結果(操作ごと)。
export type RecordSendResult = {
  revision: number | null;
  applied: boolean;
  appliedFields: string[] | null;
  hasRejectedFields: boolean;
};

export const EMPTY_RECORD: RoundRecord = { base: undefined, items: [] };

function isConfirmed(item: RecordItem): boolean {
  return item.ackedRevision !== undefined;
}

export function appendPending(
  record: RoundRecord,
  operation: SyncOperation,
): RoundRecord {
  const item: RecordItem = {
    eventId: operation.eventId,
    operation,
    saved: false,
  };
  return { ...record, items: [...record.items, item] };
}

// 保存が終わった。
export function markPersisted(
  record: RoundRecord,
  eventId: string,
): RoundRecord {
  return {
    ...record,
    items: record.items.map((item) =>
      item.eventId === eventId ? { ...item, saved: true } : item,
    ),
  };
}

// ベースに反映済みの確定済みの操作を外す。ベースが削除の印(null)のときは、確定済みの操作を全て外す。
function dropReflected(record: RoundRecord): RoundRecord {
  const current = record.base?.base;
  if (current === undefined) return record;
  return {
    ...record,
    items: record.items.filter(
      (item) => !(isConfirmed(item) && reflectsBase(current, rowOf(item))),
    ),
  };
}

function rowOf(item: RecordItem) {
  return {
    operation: item.operation,
    ackedRevision: item.ackedRevision,
  };
}

// 起動時の読み込みで読んだ保存の組を、記録へ合流する。
// 起動時の記録は、ベースも確定も持たず、読み込み中に追記した操作だけを持つ。保存の行のうち記録に無い操作を前に、記録の操作を後ろに並べる。
export function mergeStored(
  record: RoundRecord,
  group: StoredGroup,
): RoundRecord {
  const own = new Set(record.items.map((item) => item.eventId));
  const stored: RecordItem[] = group.entries
    .filter((row) => !own.has(row.eventId))
    .map((row) => ({
      eventId: row.eventId,
      operation: row.operation,
      saved: true,
      ackedRevision: row.ackedRevision,
      confirmedFields:
        row.ackedRevision !== undefined ? (row.ackedFields ?? null) : undefined,
    }));
  return {
    base: record.base ?? group.base,
    items: [...stored, ...record.items],
  };
}

// 取得したベースを反映する。記録のベースより開始時刻が新しいときだけベースを置き換え、そのベースに反映済みの確定済みの操作を外す。
// 記録のベースよりrevisionが古い取得は反映しない(同じ列への取得が重なったとき、後着の古い状態を入れない)。
export function commitFetched(
  record: RoundRecord,
  incoming: RecordBase,
): RoundRecord {
  if (record.base && record.base.startedAt >= incoming.startedAt) return record;
  if (isOlderFetch(record, incoming.base)) return record;
  return dropReflected({ ...record, base: incoming });
}

// 組が消えた後でも、最後に取り込んだベースより古い状態の取得は、保存も反映もしない。
export function isOlderFetch(
  record: RoundRecord,
  fetched: RoundBaseRecord | null,
): boolean {
  const current = record.base?.base;
  return current != null && fetched !== null && isOlderBase(current, fetched);
}

// 送信が成功した結果を記録へ書く。効かなかった操作は列から外す。
// `diverged`は、効かなかった操作または項目があったか。
export function applySendResults(
  record: RoundRecord,
  eventIds: readonly string[],
  results: readonly RecordSendResult[],
): { record: RoundRecord; diverged: boolean; ineffective: string[] } {
  let diverged = false;
  const ineffective: string[] = [];
  const confirmed = new Map<string, RecordSendResult>();
  eventIds.forEach((eventId, index) => {
    const result = results[index];
    if (!result.applied || result.hasRejectedFields) diverged = true;
    if (result.applied) confirmed.set(eventId, result);
    else ineffective.push(eventId);
  });
  const items = record.items.map((item) => {
    const result = confirmed.get(item.eventId);
    if (!result) return item;
    return {
      ...item,
      confirmedFields: result.appliedFields,
      ackedRevision: result.revision ?? 0,
    };
  });
  return {
    record: retireItems({ ...record, items }, ineffective),
    diverged,
    ineffective,
  };
}

// 記録から外す。
export function retireItems(
  record: RoundRecord,
  eventIds: readonly string[],
): RoundRecord {
  if (eventIds.length === 0) return record;
  return {
    ...record,
    items: record.items.filter((item) => !eventIds.includes(item.eventId)),
  };
}

// 送る候補になる、確定していない操作(列の順)。確定済みの操作は他の操作を止めないため含めない。
export function outboxOf(record: RoundRecord): {
  eventId: string;
  saved: boolean;
  operation: SyncOperation;
}[] {
  return record.items
    .filter((item) => !isConfirmed(item))
    .map((item) => ({
      eventId: item.eventId,
      saved: item.saved,
      operation: item.operation,
    }));
}

// 画面が適用に使う操作。保存の完了前の操作を含む全項目(保存の完了では変わらない)。
export function operationsOf(record: RoundRecord): AppliedOperation[] {
  return record.items.map((item) => ({
    operation: item.operation,
    confirmedFields: isConfirmed(item)
      ? (item.confirmedFields ?? null)
      : undefined,
  }));
}

// 2つの画面用の操作の列が、同じ操作を同じ順に、同じ確定の項目で並べているか。
// 操作と確定の項目は参照で比べる(記録の集約は、保存の完了や確定で操作の参照を変えない)。
export function sameRecordedOperations(
  a: readonly AppliedOperation[],
  b: readonly AppliedOperation[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].operation !== b[i].operation) return false;
    if (a[i].confirmedFields !== b[i].confirmedFields) return false;
  }
  return true;
}

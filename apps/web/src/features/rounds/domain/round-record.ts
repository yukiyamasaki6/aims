import {
  isOlderBase,
  type RecordBase,
  type RoundBaseRecord,
  reflectsBase,
} from "./round-base";
import type { SyncOperation } from "./sync-events";

// 1つのラウンドの端末の記録。ベースと操作の列のうち、画面が読む部分を、変更しない値と関数にしたもの。
// 送信の状態(送信中、リトライ待機、保留)は持たない(同期の送信の状態が持つ)。
type RecordItem = {
  readonly eventId: string;
  readonly operation: SyncOperation;
  // 保存の試みが終わった。
  readonly saved: boolean;
  readonly seq?: number;
  // このタブでの保存が終わった時点の`persistTick`。
  readonly savedTick?: number;
  readonly ackedRevision?: number;
  readonly ackedApplied?: boolean;
  // 確定済みの結果。未確定ならundefined、全項目が効いたならnull、項目に分ける操作で一部だけ効いたなら効いた項目。
  readonly confirmedFields?: string[] | null;
};

export type RoundRecord = {
  readonly base: RecordBase | undefined;
  readonly items: readonly RecordItem[];
  // 記録から外した操作。保存先から読み直した行を、外した後に足し直さないために覚える。
  readonly retired: ReadonlySet<string>;
  // このタブでの保存が終わるたびに進める。古い読み込みが、保存済みの操作を外さないための目印。
  readonly persistTick: number;
  // 送信中(リトライ待機を含む)の操作。他のタブの読み込みで外さない。
  readonly inFlight: ReadonlySet<string>;
};

// 保存先の1行。保存先の型に依存しないよう、同じ形をここで宣言する。
export type RecordRow = {
  seq: number;
  eventId: string;
  // 保存先の行の利用者。あるときは、取り込む記録の利用者と照合する。
  userId?: string | null;
  ackedRevision?: number;
  ackedApplied?: boolean;
  ackedFields?: string[];
  operation: SyncOperation;
};

export type RecordGroup = {
  base: RecordBase | undefined;
  entries: readonly RecordRow[];
};

export type RecordedOperation = {
  operation: SyncOperation;
  confirmedFields: string[] | null | undefined;
};

// 送信の結果(操作ごと)。
export type RecordSendResult = {
  revision: number | null;
  applied: boolean;
  appliedFields: string[] | null;
  rejectedFields: readonly { field: string; reason: string }[];
};

export const EMPTY_RECORD: RoundRecord = {
  base: undefined,
  items: [],
  retired: new Set(),
  persistTick: 0,
  inFlight: new Set(),
};

function isConfirmed(item: RecordItem): boolean {
  return item.ackedRevision !== undefined;
}

// 保存が終わり、確定しておらず、送信中でもない操作(送信の状態でいう待ちか保留)。
function isUnsettled(record: RoundRecord, item: RecordItem): boolean {
  return item.saved && !isConfirmed(item) && !record.inFlight.has(item.eventId);
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

// 保存の試みが終わった。保存に失敗したときは`seq`が無い(メモリの列から送信は続ける)。
export function markPersisted(
  record: RoundRecord,
  eventId: string,
  seq: number | undefined,
): RoundRecord {
  const persistTick = record.persistTick + 1;
  return {
    ...record,
    persistTick,
    items: record.items.map((item) =>
      item.eventId === eventId
        ? { ...item, saved: true, seq, savedTick: persistTick }
        : item,
    ),
  };
}

// 新しい方のベースを使う。変わらなければnull。
function chooseBase(
  current: RecordBase | undefined,
  candidate: RecordBase | undefined,
): RecordBase | null {
  if (!candidate) return null;
  if (current && current.startedAt >= candidate.startedAt) return null;
  return candidate;
}

// 取得したベースを組に入れたときに、そのベースに反映済みの確定済みの操作を外す。
function dropReflected(record: RoundRecord): RoundRecord {
  const current = record.base?.base;
  if (current === undefined) return record;
  const retired = new Set(record.retired);
  const items = record.items.filter((item) => {
    if (isConfirmed(item) && reflectsBase(current, rowOf(item))) {
      retired.add(item.eventId);
      return false;
    }
    return true;
  });
  return { ...record, items, retired };
}

function rowOf(item: RecordItem) {
  return {
    operation: item.operation,
    ackedRevision: item.ackedRevision,
    ackedApplied: item.ackedApplied,
  };
}

// 別のタブが確定前に破棄した操作。確定済みの操作は、共有の組のベースを取ったときだけ、組から無くなったものを外す(そのベースとともに外れたもの)。
function isSettledElsewhere(
  record: RoundRecord,
  item: RecordItem,
  rowIds: ReadonlySet<string>,
  sharedBaseTaken: boolean,
  readAt: number,
): boolean {
  if (item.seq === undefined || (item.savedTick ?? 0) > readAt) return false;
  if (rowIds.has(item.eventId)) return false;
  if (isConfirmed(item)) return sharedBaseTaken;
  return isUnsettled(record, item);
}

function itemFromRow(row: RecordRow): RecordItem {
  const confirmed = row.ackedRevision !== undefined;
  return {
    eventId: row.eventId,
    operation: row.operation,
    saved: true,
    seq: row.seq,
    ackedRevision: row.ackedRevision,
    ackedApplied: row.ackedApplied,
    confirmedFields: confirmed ? (row.ackedFields ?? null) : undefined,
  };
}

// 記録にある操作へ、組の行の`seq`と確定を補う。
function completeFromRow(
  record: RoundRecord,
  item: RecordItem,
  row: RecordRow,
): RecordItem {
  const seq = item.seq ?? row.seq;
  if (row.ackedRevision !== undefined && isUnsettled(record, item)) {
    return {
      ...item,
      seq,
      confirmedFields: row.ackedFields ?? null,
      ackedRevision: row.ackedRevision,
      ackedApplied: row.ackedApplied,
    };
  }
  return { ...item, seq };
}

// 組の行を取り込む。無い操作は足し、ある操作は補う。
function mergeRows(
  record: RoundRecord,
  kept: readonly RecordItem[],
  rows: readonly RecordRow[],
): RecordItem[] {
  const next = [...kept];
  const index = new Map(next.map((item, i) => [item.eventId, i]));
  for (const row of rows) {
    const at = index.get(row.eventId);
    if (at === undefined) {
      index.set(row.eventId, next.length);
      next.push(itemFromRow(row));
    } else {
      next[at] = completeFromRow(record, next[at], row);
    }
  }
  return next;
}

// `seq`を持つ操作を`seq`の昇順に、その後ろに`seq`を持たない操作を元の順で並べる。
function orderBySeq(items: readonly RecordItem[]): RecordItem[] {
  const withSeq = items
    .filter((item) => item.seq !== undefined)
    .sort((first, second) => (first.seq ?? 0) - (second.seq ?? 0));
  return [...withSeq, ...items.filter((item) => item.seq === undefined)];
}

// 保存先から読んだ組(現在の利用者の、その列の全件)を、記録へ合わせる。
// ベースは新しい方を使う。確定済みの操作は、取得のベースをこの記録のベースにしたときはそのベースに反映済みのものを、共有の組のベースを取ったときは組から無くなったものを外す。それ以外では外さない。
export function adoptGroup(
  record: RoundRecord,
  group: RecordGroup,
  options: { fetched?: RecordBase; readAt: number },
): RoundRecord {
  const shared = chooseBase(record.base, group.base);
  let base = shared ?? record.base;
  const fetched = chooseBase(base, options.fetched);
  base = fetched ?? base;
  const rows = group.entries.filter(
    (row) => row.ackedApplied !== false && !record.retired.has(row.eventId),
  );
  const rowIds = new Set(rows.map((row) => row.eventId));
  const retired = new Set(record.retired);
  const kept: RecordItem[] = [];
  for (const item of record.items) {
    if (
      isSettledElsewhere(record, item, rowIds, shared !== null, options.readAt)
    ) {
      retired.add(item.eventId);
    } else {
      kept.push(item);
    }
  }
  const merged = mergeRows(record, kept, rows);
  const adopted: RoundRecord = {
    ...record,
    base,
    retired,
    items: orderBySeq(merged),
  };
  return fetched ? dropReflected(adopted) : adopted;
}

// 端末へ保存できなかったときの、このタブだけの反映。
export function commitFetched(
  record: RoundRecord,
  incoming: RecordBase,
): RoundRecord {
  const base = chooseBase(record.base, incoming);
  if (!base) return record;
  return dropReflected({ ...record, base });
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
    if (!result.applied || result.rejectedFields.length > 0) diverged = true;
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
      ackedApplied: true,
    };
  });
  return {
    record: retireItems({ ...record, items }, ineffective),
    diverged,
    ineffective,
  };
}

// 記録から外して、再び現れないよう覚える。
export function retireItems(
  record: RoundRecord,
  eventIds: readonly string[],
): RoundRecord {
  if (eventIds.length === 0) return record;
  const retired = new Set(record.retired);
  for (const id of eventIds) retired.add(id);
  return {
    ...record,
    retired,
    items: record.items.filter((item) => !eventIds.includes(item.eventId)),
  };
}

export function setInFlight(
  record: RoundRecord,
  eventIds: readonly string[],
  inFlight: boolean,
): RoundRecord {
  const marks = new Set(record.inFlight);
  for (const id of eventIds) {
    if (inFlight) marks.add(id);
    else marks.delete(id);
  }
  return { ...record, inFlight: marks };
}

// 送る候補になる、確定していない操作(列の順)。確定済みの操作は他の操作を止めないため含めない。
export function outboxOf(record: RoundRecord): {
  eventId: string;
  saved: boolean;
  hasSeq: boolean;
  operation: SyncOperation;
}[] {
  return record.items
    .filter((item) => !isConfirmed(item))
    .map((item) => ({
      eventId: item.eventId,
      saved: item.saved,
      hasSeq: item.seq !== undefined,
      operation: item.operation,
    }));
}

// 画面が適用に使う、保存が完了した操作。
export function operationsOf(record: RoundRecord): RecordedOperation[] {
  return record.items
    .filter((item) => item.saved)
    .map((item) => ({
      operation: item.operation,
      confirmedFields: isConfirmed(item)
        ? (item.confirmedFields ?? null)
        : undefined,
    }));
}

// この記録のメモリ上の操作を、端末の組の形にする。
export function memoryEntries(
  record: RoundRecord,
  streamId: string,
  userId: string | null,
) {
  return record.items.map((item) => ({
    seq: item.seq ?? -1,
    eventId: item.eventId,
    streamId,
    userId,
    operation: item.operation,
    ackedRevision: item.ackedRevision,
    ackedApplied: item.ackedApplied,
  }));
}

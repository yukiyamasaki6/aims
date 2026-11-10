import type {
  OpBase,
  OpLogEntry,
  OpLogStore,
  StreamBase,
  StreamGroup,
  StreamRules,
} from "./contract/op-log-store";

export type MemoryOpLogStore<Op extends OpBase, Base> = OpLogStore<Op, Base> & {
  // 保存している行。2つのハブが同じ保存先を共有する様子を、テストが覗く。
  rows: OpLogEntry<Op>[];
};

// 端末の保存の代わりに、2つのハブが共有できるメモリの保存先。
// 実物(IndexedDB)の全ての規則は持たず、取得の反映は「新しい取得だけを採り、反映済みの行を消す」までを再現する。
export function createMemoryOpLogStore<Op extends OpBase, Base>(
  rules: Pick<StreamRules<Op, Base>, "reflects">,
): MemoryOpLogStore<Op, Base> {
  const rows: OpLogEntry<Op>[] = [];
  const bases = new Map<string, StreamBase<Base>>();
  let seq = 0;

  const groupOf = (
    streamId: string,
    userId: string | null,
  ): StreamGroup<Op, Base> => ({
    base: bases.get(`${userId}/${streamId}`),
    entries: rows.filter(
      (row) => row.streamId === streamId && row.userId === userId,
    ),
  });

  return {
    rows,
    async append(entry) {
      seq += 1;
      rows.push({ ...entry, seq });
      return seq;
    },
    async loadAll(userId) {
      const all = new Map<string, StreamGroup<Op, Base>>();
      for (const row of rows) {
        if (row.userId === userId) {
          all.set(row.streamId, groupOf(row.streamId, userId));
        }
      }
      for (const key of bases.keys()) {
        const [owner, streamId] = key.split("/");
        if (owner === String(userId)) {
          all.set(streamId, groupOf(streamId, userId));
        }
      }
      return all;
    },
    async commit(streamId, userId, base, startedAt) {
      const key = `${userId}/${streamId}`;
      const stored = bases.get(key);
      const newer = stored !== undefined && stored.startedAt > startedAt;
      const adopted = newer ? stored : { startedAt, base };
      for (const row of groupOf(streamId, userId).entries) {
        if (rules.reflects(adopted.base, row)) {
          rows.splice(rows.indexOf(row), 1);
        }
      }
      if (!newer) bases.set(key, adopted);
      return groupOf(streamId, userId);
    },
    async ack(eventId, revision, applied, appliedFields) {
      const row = rows.find((candidate) => candidate.eventId === eventId);
      if (row && row.ackedRevision === undefined) {
        row.ackedRevision = revision ?? 0;
        row.ackedApplied = applied;
        if (appliedFields) row.ackedFields = appliedFields;
      }
    },
    async retire(eventIds) {
      for (const id of eventIds) {
        const index = rows.findIndex((row) => row.eventId === id);
        if (index >= 0) rows.splice(index, 1);
      }
    },
  };
}

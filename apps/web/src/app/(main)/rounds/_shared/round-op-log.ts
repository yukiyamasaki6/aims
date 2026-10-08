import type { StreamBase, StreamGroup } from "@/features/op-log/op-log-types";
import type { OpSyncOperation } from "@/features/op-log/op-sync";
import type { RoundBaseRecord } from "../[id]/round-base";
import { roundOpHub } from "./round-op-hub";
import type { SyncOperation } from "./sync-events";

// ラウンドごとに、順序を保つ単位を分ける。
export function roundStreamId(roundId: string): string {
  return `round:${roundId}`;
}

// 列のIDからラウンドIDを得る。ラウンドの列でなければnull。
function roundIdOf(streamId: string): string | null {
  return streamId.startsWith("round:") ? streamId.slice("round:".length) : null;
}

export type RoundGroup = StreamGroup<SyncOperation, RoundBaseRecord>;

// 端末のメモリにある、1つのラウンドのベースと操作(保存が完了したもの)。
export type RoundSnapshot = {
  base: StreamBase<RoundBaseRecord> | undefined;
  operations: readonly OpSyncOperation<SyncOperation>[];
};

export type RoundOpSync = ReturnType<typeof roundOpHub.acquire>;

// 列(保存が完了した操作)にラウンドの削除があれば、そのラウンドは削除済み。一覧と詳細が同じ規則で判定する。
export function hasRoundDeletion(
  operations: readonly SyncOperation[],
): boolean {
  return operations.some((operation) => operation.type === "round.disabled");
}

// 画面とフックが端末の操作の列へアクセスする唯一の入り口。
// 読み取りと追記は、ハブの現在のユーザーに限る。画面側でユーザーを解決しない。
export const roundOpLog = {
  // IndexedDBの、そのラウンドのベースと列(`seq`順、読み替え済み、確定のrevisionを含む)。失敗時は空。
  async load(roundId: string): Promise<RoundGroup> {
    try {
      return await roundOpHub.read(roundStreamId(roundId));
    } catch {
      return { base: undefined, entries: [] };
    }
  },
  // 取得したベース(取得できなかったときはnull)を反映する。保存の失敗は、このタブだけの反映になる。
  // `userId`は取得に使ったセッションのユーザー。
  commit(
    roundId: string,
    base: RoundBaseRecord | null,
    startedAt: number,
    userId: string | null,
  ): Promise<RoundGroup> {
    return roundOpHub.commit(roundStreamId(roundId), base, startedAt, userId);
  },
  // サーバーに無い(削除が確定した)ことを、削除の印として反映する。確定済みの操作は端末から外れる。
  commitDeleted(roundId: string, startedAt: number): Promise<RoundGroup> {
    return roundOpHub.commit(
      roundStreamId(roundId),
      null,
      startedAt,
      roundOpHub.getUserId(),
    );
  },
  // 端末が保持している、削除されておらず作成が確定しているラウンドのID(ベースか操作を持つもの)。失敗時は空。
  async retainedRoundIds(): Promise<string[]> {
    try {
      const stored = await roundOpHub.readStored();
      const ids: string[] = [];
      for (const [streamId, group] of stored) {
        const roundId = roundIdOf(streamId);
        if (roundId === null) continue;
        const operations = group.entries.map((entry) => entry.operation);
        if (hasRoundDeletion(operations)) continue;
        // 確定していない作成は、サーバーにまだ無い。取得で返らなくても削除と扱わない。
        if (
          group.entries.some(
            (entry) =>
              entry.operation.type === "round.created" &&
              entry.ackedRevision === undefined,
          )
        ) {
          continue;
        }
        if (group.base?.base || group.entries.length > 0) ids.push(roundId);
      }
      return ids;
    } catch {
      return [];
    }
  },
  // 起動時の読み込みの完了後の、ハブのメモリにある全てのラウンドのベースと列(保存が完了した操作)。失敗時は空。
  async loadAll(): Promise<Map<string, RoundSnapshot>> {
    try {
      const all = await roundOpHub.readAll();
      const byRound = new Map<string, RoundSnapshot>();
      for (const [streamId, snapshot] of all) {
        const roundId = roundIdOf(streamId);
        if (roundId !== null) byRound.set(roundId, snapshot);
      }
      return byRound;
    } catch {
      return new Map();
    }
  },
  // 1つのラウンドの常駐の送信器(追記、購読、取り込み)。入出力を起こさないため、描画中に呼んでよい。
  round(roundId: string): RoundOpSync {
    return roundOpHub.acquire(roundStreamId(roundId));
  },
};

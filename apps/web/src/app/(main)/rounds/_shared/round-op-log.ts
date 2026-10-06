import type { OpSyncOperation } from "@/features/op-log/op-sync";
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
  // IndexedDBの、そのラウンドの列(`seq`順、読み替え済み、確定のrevisionを含む)。失敗時は空。
  async load(roundId: string) {
    try {
      return await roundOpHub.read(roundStreamId(roundId));
    } catch {
      return [];
    }
  },
  // 起動時の読み込みの完了後の、ハブのメモリにある全てのラウンドの列(保存が完了した操作)。失敗時は空。
  async loadAll(): Promise<
    Map<string, readonly OpSyncOperation<SyncOperation>[]>
  > {
    try {
      const all = await roundOpHub.readAll();
      const byRound = new Map<
        string,
        readonly OpSyncOperation<SyncOperation>[]
      >();
      for (const [streamId, operations] of all) {
        const roundId = roundIdOf(streamId);
        if (roundId !== null) byRound.set(roundId, operations);
      }
      return byRound;
    } catch {
      return new Map();
    }
  },
  // 1つのラウンドの常駐の送信器(追記、購読、取り込み、反映済みの除去)。入出力を起こさないため、描画中に呼んでよい。
  round(roundId: string): RoundOpSync {
    return roundOpHub.acquire(roundStreamId(roundId));
  },
};

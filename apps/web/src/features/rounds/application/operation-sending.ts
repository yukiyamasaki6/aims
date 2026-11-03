import type { SyncOperation } from "../domain/sync-events";
import type { RoundRecordHub } from "./round-record-hub";

// 操作ごとの、サーバーの判定結果。効かなかった操作のrevisionはnull。
export type OpResult = {
  revision: number | null;
  applied: boolean;
  appliedFields: string[] | null;
  rejectedFields: { field: string; reason: string }[];
  reason: string | null;
};

type SendFailureCause =
  // statusはHTTPステータス。fetchの失敗は0、取得できなければ未定義。codeはPostgRESTが返すSQLSTATE。
  { type: "rpc"; status?: number; code?: string } | { type: "exception" };

// 送信が成功したときは、要求の操作と同じ順の判定結果を返す。
export type SendOutcome =
  | { ok: true; results: OpResult[] }
  | { ok: false; cause: SendFailureCause };

// 書き込みのRPC。例外: 投げることがある(手続きがexceptionの失敗に変える)。
export type RoundTransport = {
  send(
    entries: { eventId: string; operation: SyncOperation }[],
  ): Promise<SendOutcome>;
};

export type SendReport =
  | { ok: true; diverged: boolean }
  | { ok: false; cause: SendFailureCause };

// 操作の送信と、確定の記録。
export function createOperationSending(deps: {
  hub: RoundRecordHub;
  transport: RoundTransport;
}) {
  const { hub, transport } = deps;
  return {
    // 成功したら記録へ確定を書き、効かなかった操作を外し、書き込みの後に他のタブへ知らせる。
    async send(
      streamId: string,
      eventIds: readonly string[],
    ): Promise<SendReport> {
      const items = hub.record(streamId).items;
      const entries = eventIds.flatMap((eventId) => {
        const item = items.find((entry) => entry.eventId === eventId);
        return item ? [{ eventId, operation: item.operation }] : [];
      });
      if (entries.length === 0) return { ok: true, diverged: false };
      const generation = hub.generation();
      let outcome: SendOutcome;
      try {
        outcome = await transport.send(entries);
      } catch {
        return { ok: false, cause: { type: "exception" } };
      }
      if (!outcome.ok) return outcome;
      const { diverged } = hub.applySendResults(
        streamId,
        entries.map((entry) => entry.eventId),
        outcome.results,
        generation,
      );
      return { ok: true, diverged };
    },
  };
}

export type OperationSending = ReturnType<typeof createOperationSending>;

import type { SyncOperation } from "../domain/sync-events";
import type { SyncFailure } from "../domain/sync-failure";
import type { RoundRecordHub } from "./round-record-hub";

// 操作ごとの、サーバーの判定結果。効かなかった操作のrevisionはnull。
// 効かなかった項目の中身(項目名と理由)は取り込まず、あるかどうかだけを持つ。
export type OpResult = {
  revision: number | null;
  applied: boolean;
  appliedFields: string[] | null;
  hasRejectedFields: boolean;
};

// 送信が成功したときは、要求の操作と同じ順の判定結果を返す。
export type SendOutcome =
  | { ok: true; results: OpResult[] }
  | { ok: false; failure: SyncFailure };

// 書き込みのRPC。例外: 投げることがある(手続きがexceptionの失敗に変える)。
export type RoundTransport = {
  send(
    entries: { eventId: string; operation: SyncOperation }[],
  ): Promise<SendOutcome>;
};

export type SendReport = { ok: true } | { ok: false; failure: SyncFailure };

// 操作の送信と、確定の記録。
export function createOperationSending(deps: {
  hub: Pick<RoundRecordHub, "record" | "generation" | "applySendResults">;
  transport: RoundTransport;
}) {
  const { hub, transport } = deps;
  return {
    // 成功したら記録へ確定を書き、効かなかった操作を外す。
    async send(
      streamId: string,
      eventIds: readonly string[],
    ): Promise<SendReport> {
      const items = hub.record(streamId).items;
      const entries = eventIds.flatMap((eventId) => {
        const item = items.find((entry) => entry.eventId === eventId);
        return item ? [{ eventId, operation: item.operation }] : [];
      });
      if (entries.length === 0) return { ok: true };
      const generation = hub.generation();
      const outcome = await transport.send(entries);
      if (!outcome.ok) return outcome;
      hub.applySendResults(
        streamId,
        entries.map((entry) => entry.eventId),
        outcome.results,
        generation,
      );
      return { ok: true };
    },
  };
}

export type OperationSending = ReturnType<typeof createOperationSending>;

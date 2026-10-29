import type { RoundReconciliation } from "@/features/rounds";
import type { RecordsPort } from "../application/records-port";

// ラウンドの機能の入口を、同期の約束で包む。
export function createRoundsRecords(
  reconciliation: RoundReconciliation,
): RecordsPort {
  return {
    ...reconciliation,
    async send(streamId, eventIds) {
      const report = await reconciliation.send(streamId, eventIds);
      if (report.ok) return report;
      return {
        ok: false,
        cause:
          report.cause === "rpc"
            ? { type: "rpc", status: report.status, code: report.code }
            : { type: "exception" },
      };
    },
  };
}

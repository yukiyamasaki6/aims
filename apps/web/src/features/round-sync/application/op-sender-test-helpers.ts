import { vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createTestReconciliation } from "@/features/rounds/application/round-record-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createOpSender } from "./op-sender";

type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

export const flush = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// 1つのタブ分の送信器の組み立て。記録のハブ、送信、突き合わせは実物で、転送の結果、時計、サインインの状態、通信の可否をテストが動かす。
export function createSenderRig(
  options: {
    userId?: string | null;
    shared?: Parameters<typeof createTestReconciliation>[0] extends infer O
      ? O extends { shared?: infer S }
        ? S
        : never
      : never;
    reading?: Reading;
    offline?: boolean;
  } = {},
) {
  const base = createTestReconciliation({
    shared: options.shared,
    userId: options.userId,
  });
  const clock = createManualClock(1000);
  const connectivity = createFakeConnectivity(options.offline);
  const session: Pick<SessionReader, "readSession"> & { reading: Reading } = {
    reading:
      options.reading ??
      ({ status: "authenticated", userId: "user-1" } as Reading),
    readSession: vi.fn(async (): Promise<Reading> => session.reading),
  };
  const records = base.reconciliation;
  const sender = createOpSender({
    records,
    session,
    clock,
    connectivity,
  });
  return { ...base, records, sender, clock, connectivity, session };
}

import { vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createTestReconciliation } from "@/features/rounds/application/round-record-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import {
  createOpSender,
  type SenderLock,
  type SenderMessage,
} from "./op-sender";

type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

// 送る役の選出とタブの間の知らせを、メモリで再現する。先に求めたタブが役を持ち、手放すと次のタブが引き継ぐ。
// `solo`は、Web Locksが無い環境(求めた全員が単独の送り手)。
export function createSenderLockBus(options: { solo?: boolean } = {}) {
  const listeners = new Set<(message: SenderMessage) => void>();
  const waiting: (() => void)[] = [];
  let holder: symbol | null = null;

  function grant() {
    if (holder !== null) return;
    waiting.shift()?.();
  }

  return {
    // タブごとの送る役の約束を作る。
    lock(): SenderLock {
      let mine: ((message: SenderMessage) => void) | undefined;
      return {
        request(onElected) {
          if (options.solo) {
            void onElected();
            return () => {};
          }
          const token = Symbol("holder");
          let cancelled = false;
          const take = () => {
            if (cancelled) return grant();
            holder = token;
            void onElected();
          };
          waiting.push(take);
          grant();
          return () => {
            cancelled = true;
            if (holder === token) {
              holder = null;
              grant();
            }
          };
        },
        open(listener) {
          mine = listener;
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        post(message) {
          for (const listener of [...listeners]) {
            if (listener !== mine) listener(message);
          }
        },
      };
    },
  };
}

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
    bus?: ReturnType<typeof createSenderLockBus>;
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
  const bus = options.bus ?? createSenderLockBus();
  const sender = createOpSender({
    records,
    session,
    lock: bus.lock(),
    clock,
    connectivity,
  });
  return { ...base, records, sender, clock, connectivity, session, bus };
}

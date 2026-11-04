import { vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { createOpSender } from "./op-sender";
import { createOperationSending } from "./operation-sending";
import {
  createManualTransport,
  createTestRoundHub,
} from "./round-record-test-helpers";

type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

export const flush = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// 1つのタブ分の送信器の組み立て。記録のハブと送信は実物で、転送の結果、時計、サインインの状態、通信の可否をテストが動かす。
// サインインの状態は、認証済み、未認証、不明の3値を返し分けられる。
export function createSenderRig(
  options: {
    userId?: string | null;
    shared?: Parameters<typeof createTestRoundHub>[0];
    reading?: Reading;
    offline?: boolean;
  } = {},
) {
  const { hub, store } = createTestRoundHub(options.shared);
  hub.start(options.userId === undefined ? "user-1" : options.userId);
  const { transport, sent } = createManualTransport();
  const sending = createOperationSending({ hub, transport });
  const clock = createManualClock(1000);
  const connectivity = createFakeConnectivity(options.offline);
  const signIn: { reading: Reading; read: () => Promise<Reading> } = {
    reading: options.reading ?? { status: "authenticated", userId: "user-1" },
    read: vi.fn(async (): Promise<Reading> => signIn.reading),
  };
  const sender = createOpSender({
    hub,
    sending,
    sessionReader: { readSession: signIn.read },
    clock,
    connectivity,
  });
  return {
    hub,
    store,
    transport,
    sent,
    sending,
    sender,
    clock,
    connectivity,
    signIn,
  };
}

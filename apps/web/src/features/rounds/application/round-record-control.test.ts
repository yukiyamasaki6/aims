import { describe, expect, it, vi } from "vitest";
import { roundUpdated, shotRecorded } from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import { createSenderRig, flush } from "./op-sender-test-helpers";
import { createRoundRecordControl } from "./round-record-control";
import type { RoundRecordHub } from "./round-record-hub";

const STREAM = roundStreamId("round-1");

// 記録と送信器の呼び出しを、1つの並びへ名前で積む偽。順序が検証対象で、中身の処理は別のテストで確かめる。
function createOrderedFakes(options: { recordUserId?: string | null } = {}) {
  const calls: string[] = [];
  const record = (name: string) =>
    vi.fn((..._args: unknown[]) => {
      calls.push(name);
    });
  const hub = {
    start: record("hub.start"),
    userId: vi.fn(() => options.recordUserId ?? null),
  };
  const sender = {
    start: record("sender.start"),
    resumeHeld: record("sender.resumeHeld"),
  };
  const control = createRoundRecordControl({
    hub: hub as unknown as Pick<RoundRecordHub, "start" | "userId">,
    sender,
  });
  return { calls, hub, sender, control };
}

// 実物の記録と送信器で組んだ制御。転送の結果、時計、サインインの状態はテストが動かす。
function createRealControl(options: Parameters<typeof createSenderRig>[0]) {
  const rig = createSenderRig(options);
  const control = createRoundRecordControl({
    hub: rig.hub,
    sender: rig.sender,
  });
  return { ...rig, control };
}

describe("順序", () => {
  it("startは、記録の起動が終わった後に送信器を起動し、利用者を記録へ渡す", () => {
    // Given
    const { calls, hub, control } = createOrderedFakes();

    // When
    control.start("user-1");

    // Then
    expect(calls).toEqual(["hub.start", "sender.start"]);
    expect(hub.start).toHaveBeenCalledWith("user-1");
  });
});

describe("記録の制御", () => {
  it("始めは、記録の始めに委譲する", async () => {
    // Given
    const { hub, control } = createRealControl({ userId: null });

    // When
    control.start("user-1");
    await hub.ready();
    const matches = [
      control.isRecordUser("user-1"),
      control.isRecordUser("user-2"),
    ];

    // Then
    expect(matches).toEqual([true, false]);
  });

  it("利用者の照合は、記録の利用者と同じなら真、違えば偽を返す", async () => {
    // Given
    const { hub, control } = createRealControl({});
    await hub.append(STREAM, roundUpdated());

    // When
    const matches = [
      control.isRecordUser("user-1"),
      control.isRecordUser("user-2"),
    ];

    // Then
    expect(matches).toEqual([true, false]);
  });

  it("記録の利用者がいない(null)ときは、どの利用者に対しても偽を返す", async () => {
    // Given
    const { hub, control } = createRealControl({});

    // When
    control.start(null);
    await hub.ready();
    const matches = [
      control.isRecordUser("user-1"),
      control.isRecordUser("user-2"),
    ];

    // Then
    expect(matches).toEqual([false, false]);
  });

  it("別の利用者のサインインとサインアウトは、記録の利用者を替えない(切り替えは読み込み直しが行う)", async () => {
    // Given
    const { hub, control } = createRealControl({});
    await hub.append(STREAM, roundUpdated({ eventId: "a" }));

    // When
    control.signInChanged({ kind: "signed-in", userId: "user-2" });
    control.signInChanged({ kind: "signed-out" });
    const afterChanges = [
      control.isRecordUser("user-1"),
      control.isRecordUser("user-2"),
    ];

    // Then
    expect(afterChanges).toEqual([true, false]);
    expect(hub.streams()).toEqual([STREAM]);
  });

  it("記録の利用者と同じ利用者のサインインは、未認証で保留した操作を、サインインし直した後に送る", async () => {
    // Given
    const rig = createRealControl({
      reading: { status: "unauthenticated" },
    });
    await rig.hub.ready();
    rig.control.start("user-1");
    await rig.hub.append(STREAM, shotRecorded({ eventId: "a" }));
    await flush();
    const whileHeld = rig.sent.length;
    rig.signIn.reading = { status: "authenticated", userId: "user-1" };

    // When
    rig.control.signInChanged({ kind: "signed-in", userId: "user-1" });
    await flush();

    // Then
    expect(whileHeld).toBe(0);
    expect(rig.sent.map((flight) => flight.eventIds)).toEqual([["a"]]);
  });
});

describe("サインインの変化への反応", () => {
  it.each([
    ["signed-in", "user-1"],
    ["signed-in", "user-0"],
    ["signed-in", null],
  ] as const)(
    "利用者のある%sの通知で、記録の利用者が%sでも、保留した送信を戻すだけである",
    (kind, recordUserId) => {
      // Given
      const { calls, control } = createOrderedFakes({ recordUserId });

      // When
      control.signInChanged({ kind, userId: "user-1" });

      // Then
      expect(calls).toEqual(["sender.resumeHeld"]);
    },
  );

  it("サインアウトでは、何もしない", () => {
    // Given
    const { calls, control } = createOrderedFakes({
      recordUserId: "user-1",
    });

    // When
    control.signInChanged({ kind: "signed-out" });

    // Then
    expect(calls).toEqual([]);
  });
});

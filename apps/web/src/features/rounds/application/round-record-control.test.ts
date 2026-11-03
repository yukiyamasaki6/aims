import { describe, expect, it, vi } from "vitest";
import { roundUpdated, shotRecorded } from "../domain/round-op-test-helpers";
import { roundStreamId } from "../domain/sync-events";
import { createSenderRig, flush } from "./op-sender-test-helpers";
import { createRoundRecordControl } from "./round-record-control";
import type { RoundRecordHub } from "./round-record-hub";

const STREAM = roundStreamId("round-1");

// 記録と送信器の呼び出しを、1つの並びへ名前で積む偽。順序が検証対象で、中身の処理は別のテストで確かめる。
function createOrderedFakes(
  options: { failOn?: "sender.stop" | "hub.stop" } = {},
) {
  const calls: string[] = [];
  const record = (name: string) =>
    vi.fn((..._args: unknown[]) => {
      calls.push(name);
      if (name === options.failOn) throw new Error(name);
    });
  const hub = {
    start: record("hub.start"),
    stop: record("hub.stop"),
    setUser: record("hub.setUser"),
    userId: vi.fn(() => null),
  };
  const sender = {
    start: record("sender.start"),
    stop: record("sender.stop"),
    reset: record("sender.reset"),
    resumeHeld: record("sender.resumeHeld"),
    online: record("sender.online"),
  };
  const control = createRoundRecordControl({
    hub: hub as unknown as Pick<
      RoundRecordHub,
      "start" | "stop" | "setUser" | "userId"
    >,
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

  it("stopは、送信器が止まった後に記録を止める", () => {
    // Given
    const { calls, control } = createOrderedFakes();

    // When
    control.stop();

    // Then
    expect(calls).toEqual(["sender.stop", "hub.stop"]);
  });

  it("setUserは、送信の状態を捨てた後に利用者を替える", () => {
    // Given
    const { calls, hub, control } = createOrderedFakes();

    // When
    control.setUser("user-2");

    // Then
    expect(calls).toEqual(["sender.reset", "hub.setUser"]);
    expect(hub.setUser).toHaveBeenCalledWith("user-2");
  });

  it("記録の停止が例外を投げても、送信器の停止は先に終わっていて、例外は呼び出し側へ伝わる", () => {
    // Given
    const { calls, control } = createOrderedFakes({ failOn: "hub.stop" });

    // When
    const stopping = () => control.stop();

    // Then
    expect(stopping).toThrow("hub.stop");
    expect(calls).toEqual(["sender.stop", "hub.stop"]);
  });

  it("送信器の停止が例外を投げると、記録は止めず、例外は呼び出し側へ伝わる(現状の振る舞い)", () => {
    // Given
    const { calls, control } = createOrderedFakes({ failOn: "sender.stop" });

    // When
    const stopping = () => control.stop();

    // Then
    expect(stopping).toThrow("sender.stop");
    expect(calls).toEqual(["sender.stop"]);
  });
});

describe("記録の制御", () => {
  it("始めと止めは、記録の始めと止めに委譲する", async () => {
    // Given
    const { hub, control } = createRealControl({});
    await hub.append(STREAM, roundUpdated());

    // When
    control.stop();
    const afterStop = hub.streams();
    control.start("user-1");
    await hub.ready();
    const afterStart = [
      control.matchUser("user-1"),
      control.matchUser("user-2"),
    ];

    // Then
    expect(afterStop).toEqual([]);
    expect(afterStart).toEqual(["same", "other"]);
  });

  it("利用者の照合は、記録の利用者と同じなら same、違えば other を返す", async () => {
    // Given
    const { hub, control } = createRealControl({});
    await hub.append(STREAM, roundUpdated());

    // When
    const matches = [control.matchUser("user-1"), control.matchUser("user-2")];

    // Then
    expect(matches).toEqual(["same", "other"]);
  });

  it("利用者を替えると、照合の基準が新しい利用者になる", async () => {
    // Given
    const { hub, control } = createRealControl({});
    await hub.append(STREAM, roundUpdated({ eventId: "a" }));

    // When
    control.setUser("user-2");
    const afterSwitch = [
      control.matchUser("user-2"),
      control.matchUser("user-1"),
    ];

    // Then
    expect(afterSwitch).toEqual(["same", "other"]);
  });

  it("resumeSendingは、未認証で保留した操作を、サインインし直した後に送る", async () => {
    // Given
    const rig = createRealControl({
      reading: { status: "unauthenticated", message: "未認証" },
    });
    await rig.hub.ready();
    rig.control.start("user-1");
    await rig.hub.append(STREAM, shotRecorded({ eventId: "a" }));
    await flush();
    const whileHeld = rig.sent.length;
    rig.signIn.reading = { status: "authenticated", userId: "user-1" };

    // When
    rig.control.resumeSending();
    await flush();

    // Then
    expect(whileHeld).toBe(0);
    expect(rig.sent.map((flight) => flight.eventIds)).toEqual([["a"]]);
  });

  it("recoverOnlineは、リトライ待機の送信を、待機の時刻を待たずに再送する", async () => {
    // Given
    const rig = createRealControl({});
    await rig.hub.ready();
    rig.control.start("user-1");
    await rig.hub.append(STREAM, shotRecorded({ eventId: "a" }));
    await flush();
    rig.sent[0].resolve({
      ok: false,
      cause: { type: "rpc", status: 500, code: "XX000" },
    });
    await flush();
    const whileWaiting = rig.sent.length;

    // When
    rig.control.recoverOnline();
    await flush();

    // Then
    expect(whileWaiting).toBe(1);
    expect(rig.sent.map((flight) => flight.eventIds)).toEqual([["a"], ["a"]]);
  });
});

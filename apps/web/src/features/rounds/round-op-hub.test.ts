import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";

// ハブの本体と送信は別のテストで確かめるため、境界としてモックする。ハブは、送信の依存を作る関数を記録する。
const deps = vi.hoisted(() => ({
  sendRoundBatch: vi.fn(),
  hubStart: vi.fn(),
  hubOptions: { current: undefined as unknown },
}));
vi.mock("./round-op-transport", () => ({
  sendRoundBatch: deps.sendRoundBatch,
}));
vi.mock("@/features/op-log/op-sync-hub", () => ({
  createOpSyncHub: (options: unknown) => {
    deps.hubOptions.current = options;
    return { start: deps.hubStart, stop: vi.fn(), getUserId: vi.fn() };
  },
}));

type StreamDepsOf = (
  streamId: string,
  userId: string | null,
) => { send: (flight: unknown) => Promise<unknown> };

async function loadHub() {
  vi.resetModules();
  const { roundOpHub } = await import("./round-op-hub");
  const { streamDeps } = deps.hubOptions.current as {
    streamDeps: StreamDepsOf;
  };
  return { roundOpHub, streamDeps };
}

function readerOf(userId: string): SessionReader {
  return { readSession: async () => ({ status: "authenticated", userId }) };
}

const flight = { lane: "lane", entries: [] };

beforeEach(() => {
  vi.clearAllMocks();
  deps.sendRoundBatch.mockResolvedValue({ ok: true, results: [] });
});

describe("roundOpHub", () => {
  it("始めたときに渡した読み手と列のユーザーで、送信の関数を呼ぶ", async () => {
    // Given
    const { roundOpHub, streamDeps } = await loadHub();
    const reader = readerOf("user-a");
    roundOpHub.start("user-a", reader);

    // When
    await streamDeps("stream-1", "user-a").send(flight);

    // Then
    expect(deps.sendRoundBatch).toHaveBeenCalledExactlyOnceWith(
      reader,
      flight,
      "user-a",
    );
    expect(deps.hubStart).toHaveBeenCalledWith("user-a");
  });

  it("始めた後に読み手の結果が変わっても、渡した読み手そのものを送信の関数へ渡し続ける", async () => {
    // Given
    const { roundOpHub, streamDeps } = await loadHub();
    let current = "user-a";
    const reader: SessionReader = {
      readSession: async () => ({ status: "authenticated", userId: current }),
    };
    roundOpHub.start("user-a", reader);
    const { send } = streamDeps("stream-1", "user-a");

    // When
    await send(flight);
    current = "user-b";
    await send(flight);

    // Then
    expect(deps.sendRoundBatch.mock.calls.map((call) => call[0])).toEqual([
      reader,
      reader,
    ]);
    await expect(reader.readSession()).resolves.toEqual({
      status: "authenticated",
      userId: "user-b",
    });
  });

  it("始める前に送信の関数が呼ばれても投げず、確かめられないとして保留する読み手を渡す", async () => {
    // Given
    const { streamDeps } = await loadHub();

    // When
    await streamDeps("stream-1", "user-a").send(flight);

    // Then
    const [passed] = deps.sendRoundBatch.mock.calls[0] as [SessionReader];
    await expect(passed.readSession()).resolves.toEqual({ status: "unknown" });
  });
});

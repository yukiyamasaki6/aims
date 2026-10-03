import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalIdentity } from "@/features/auth/local-identity";
import type { OpLogEntry } from "@/features/op-log/op-log-types";
import type { RoundState } from "./round-op-apply";
import { roundOpStore, roundStreamId } from "./round-op-store";
import { roundUpdated, shotRecorded } from "./round-op-test-helpers";
import { sendRoundBatch } from "./round-op-transport";
import type { SyncOperation } from "./sync-events";
import { useRoundOpStack } from "./use-round-op-stack";

vi.mock("./round-op-transport", () => ({ sendRoundBatch: vi.fn() }));
const send = vi.mocked(sendRoundBatch);

const base: RoundState = {
  roundConfig: {
    name: "元",
    roundDate: "2026-09-01",
    format: "outdoor",
    bowType: "recurve",
  },
  distances: [
    {
      id: "d-1",
      position_key: "a",
      distance: 70,
      total_ends: 6,
      arrows_per_end: 6,
      target_face_id: "face-1",
      is_marked: true,
    },
  ],
  shots: [],
  roundDisabled: false,
};

function entryOf(
  operation: SyncOperation,
  seq: number,
): OpLogEntry<SyncOperation> {
  return {
    seq,
    eventId: operation.eventId,
    streamId: roundStreamId("round-1"),
    userId: getLocalIdentity(),
    label: operation.type,
    operation,
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await roundOpStore.close();
  globalThis.indexedDB = new IDBFactory();
  setOnline(true);
  send.mockResolvedValue({ ok: true, revisions: [2] });
});

describe("useRoundOpStack", () => {
  it("列が空なら、画面の状態は基準と同じで、同期済みになる", () => {
    const { result } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }),
    );

    expect(result.current.state.roundConfig).toEqual(base.roundConfig);
    expect(result.current.status).toBe("synced");
    expect(send).not.toHaveBeenCalled();
  });

  it("読み込んだ列を基準へ重ねた状態から始め、起動時に送信する", async () => {
    const entries = [entryOf(roundUpdated({ name: "未送信" }), 1)];

    const { result } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries, reflected: [] }),
    );

    expect(result.current.state.roundConfig.name).toBe("未送信");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe("synced"));
  });

  it("操作を追記すると、保存の完了後に画面の状態へ反映し、送信の完了は待たない", async () => {
    const { result } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }),
    );

    act(() => {
      result.current.append({
        operation: shotRecorded(),
        label: "距離1 1エンド1本目",
      });
    });

    await waitFor(() => expect(result.current.state.shots).toHaveLength(1));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe("synced"));
  });

  it("反映済みの操作は、起動時に列から外す", async () => {
    const operation = roundUpdated();
    await roundOpStore.append({
      eventId: operation.eventId,
      streamId: roundStreamId("round-1"),
      userId: getLocalIdentity(),
      label: operation.type,
      operation,
    });

    renderHook(() =>
      useRoundOpStack("round-1", {
        base,
        entries: [],
        reflected: [operation.eventId],
      }),
    );

    await waitFor(async () => {
      expect(
        await roundOpStore.loadStream("round:round-1", getLocalIdentity()),
      ).toEqual([]);
    });
  });

  it("オフラインになると送らず保留し、オンラインに戻ると送信する", async () => {
    const { result } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }),
    );
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
      result.current.append({
        operation: shotRecorded(),
        label: "距離1 1エンド1本目",
      });
    });
    await waitFor(() => expect(result.current.status).toBe("offline-pending"));
    expect(send).not.toHaveBeenCalled();

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe("synced"));
  });

  it("画面を閉じた後は、新しい送信をしない", async () => {
    const { result, unmount } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }),
    );
    unmount();

    act(() => {
      result.current.append({
        operation: shotRecorded(),
        label: "距離1 1エンド1本目",
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(send).not.toHaveBeenCalled();
  });
});

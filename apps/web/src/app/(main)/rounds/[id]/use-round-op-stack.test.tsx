import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalIdentity } from "@/features/auth/local-identity";
import { roundOpHub } from "../_shared/round-op-hub";
import { roundOpLog, roundStreamId } from "../_shared/round-op-log";
import { roundOpStore } from "../_shared/round-op-store";
import { roundUpdated, shotRecorded } from "../_shared/round-op-test-helpers";
import { sendRoundBatch } from "../_shared/round-op-transport";
import { loadRoundDetail } from "./load-round-detail";
import { roundTablesFromServer } from "./round-tables";
import { useRoundOpStack } from "./use-round-op-stack";

vi.mock("./load-round-detail", () => ({ loadRoundDetail: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("../_shared/round-op-transport", () => ({ sendRoundBatch: vi.fn() }));
const send = vi.mocked(sendRoundBatch);
const reload = vi.mocked(loadRoundDetail);

const applied = {
  revision: 2,
  applied: true,
  appliedFields: null,
  rejectedFields: [],
  reason: null,
};
const ineffective = {
  revision: null,
  applied: false,
  appliedFields: [],
  rejectedFields: [],
  reason: "UNFIT",
};

const base = roundTablesFromServer({
  status: "in_progress",
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
});

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
  send.mockResolvedValue({ ok: true, results: [applied] });
  roundOpHub.start(getLocalIdentity());
});

afterEach(() => {
  roundOpHub.stop();
});

describe("useRoundOpStack", () => {
  it("列が空なら、画面の状態は基準と同じで、同期済みになる", () => {
    const { result } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
    );

    expect(result.current.state.roundConfig).toEqual(base.round.config);
    expect(result.current.status).toBe("synced");
    expect(send).not.toHaveBeenCalled();
  });

  it("読み込んだ列を基準へ重ねた状態から始め、起動時に送信する", async () => {
    const operation = roundUpdated({ changes: { name: "未送信" } });
    await roundOpStore.append({
      eventId: operation.eventId,
      streamId: roundStreamId("round-1"),
      userId: getLocalIdentity(),
      operation,
    });
    const entries = await roundOpStore.loadStream(
      roundStreamId("round-1"),
      getLocalIdentity(),
    );

    const { result } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries, reflected: [] }, []),
    );

    expect(result.current.state.roundConfig.name).toBe("未送信");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe("synced"));
  });

  it("操作を追記すると、保存の完了後に画面の状態へ反映し、送信の完了は待たない", async () => {
    const { result } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
    );

    act(() => {
      result.current.append(shotRecorded());
    });

    await waitFor(() => expect(result.current.state.shots).toHaveLength(1));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe("synced"));
  });

  it("appendは、保存の完了で解決し、解決の時点で画面の状態へ反映済みである", async () => {
    const { result } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
    );

    await act(async () => {
      await result.current.append(shotRecorded());
    });

    expect(result.current.state.shots).toHaveLength(1);
  });

  it("反映済みの操作は、表示の開始時に列から外し、最初の描画から重ねない", async () => {
    const operation = roundUpdated();
    await roundOpStore.append({
      eventId: operation.eventId,
      streamId: roundStreamId("round-1"),
      userId: getLocalIdentity(),
      operation,
    });

    const { result } = renderHook(() =>
      useRoundOpStack(
        "round-1",
        {
          base,
          entries: [],
          reflected: [operation.eventId],
        },
        [],
      ),
    );
    expect(result.current.state.roundConfig).toEqual(base.round.config);

    await waitFor(async () => {
      expect(
        await roundOpStore.loadStream("round:round-1", getLocalIdentity()),
      ).toEqual([]);
    });
  });

  it("オフラインになると送らず保留し、オンラインに戻ると送信する", async () => {
    const { result } = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
    );
    setOnline(false);
    act(() => {
      roundOpHub.handleOffline();
      result.current.append(shotRecorded());
    });
    await waitFor(() => expect(result.current.status).toBe("offline-pending"));
    expect(send).not.toHaveBeenCalled();

    setOnline(true);
    act(() => {
      roundOpHub.handleOnline();
    });

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toBe("synced"));
  });

  it("画面を閉じた後も送信が続き、開き直すと同じ送信器と状態を得る", async () => {
    // Given: オフラインで操作を追記してから画面を閉じる
    const first = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
    );
    setOnline(false);
    act(() => {
      roundOpHub.handleOffline();
      first.result.current.append(shotRecorded());
    });
    await waitFor(() =>
      expect(first.result.current.state.shots).toHaveLength(1),
    );
    first.unmount();

    // When: 画面が無い状態でオンラインへ復帰する
    setOnline(true);
    act(() => {
      roundOpHub.handleOnline();
    });

    // Then: 送信され、開き直した画面は同じ送信器の状態を得る
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(roundOpLog.round("round-1")).toBe(roundOpLog.round("round-1"));
    const second = renderHook(() =>
      useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
    );
    await waitFor(() => expect(second.result.current.status).toBe("synced"));
    expect(send).toHaveBeenCalledTimes(1);
  });

  describe("効かなかった操作または項目がある応答", () => {
    const refreshed = {
      ...base,
      round: {
        ...base.round,
        config: { ...base.round.config, name: "他端末" },
      },
    };

    it("基準を取り直し、画面の状態へ反映する", async () => {
      // Given: サーバーが効かなかったと答える。取り直した基準は別の名前
      send.mockResolvedValue({ ok: true, results: [ineffective] });
      reload.mockResolvedValue({
        status: "ok",
        data: {
          base: refreshed,
          entries: [],
          reflected: [],
          targetFaces: [],
          deleted: false,
          pendingCreationEventId: null,
        },
      });
      const { result } = renderHook(() =>
        useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
      );

      // When: 操作を追記する
      act(() => {
        result.current.append(shotRecorded());
      });

      // Then: 取り直した基準が画面の状態になる
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(result.current.state.roundConfig.name).toBe("他端末"),
      );
    });

    it("効いた応答だけなら、取り直さない", async () => {
      const { result } = renderHook(() =>
        useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
      );

      act(() => {
        result.current.append(shotRecorded());
      });

      await waitFor(() => expect(result.current.status).toBe("synced"));
      expect(reload).not.toHaveBeenCalled();
    });

    it("取得に失敗しても、画面の状態は変えない", async () => {
      send.mockResolvedValue({ ok: true, results: [ineffective] });
      reload.mockRejectedValue(new Error("fail"));
      const { result } = renderHook(() =>
        useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
      );

      act(() => {
        result.current.append(shotRecorded());
      });

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(result.current.state.roundConfig.name).toBe("元");
    });

    it("取得中に別の知らせが届いたら、完了後にもう1度取得する", async () => {
      // 2件の追記は1つの要求にまとまるため、操作ごとの結果を返す。
      send.mockImplementation(async (flight) => ({
        ok: true,
        results: flight.entries.map(() => ineffective),
      }));
      let release: () => void = () => {};
      reload.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                status: "ok",
                data: {
                  base,
                  entries: [],
                  reflected: [],
                  targetFaces: [],
                  deleted: false,
                  pendingCreationEventId: null,
                },
              });
          }),
      );
      reload.mockResolvedValue({ status: "offline" });
      const { result } = renderHook(() =>
        useRoundOpStack("round-1", { base, entries: [], reflected: [] }, []),
      );

      act(() => {
        result.current.append(shotRecorded());
      });
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      act(() => {
        result.current.append(shotRecorded({ eventId: "e-2", arrowNumber: 2 }));
      });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    });
  });

  describe("完了のラウンドへの編集", () => {
    const completed = {
      ...base,
      round: { ...base.round, status: "completed" as const },
    };
    const faces = [
      {
        id: "face-1",
        target_face_spots: [
          {
            target_face_rings: [
              { score_str: "10", score_int: 10, z_index: 1, color: "#000000" },
            ],
          },
        ],
      },
    ];

    it("表示が変わる記録を積むと、続けて入力中へ戻す操作も積み、状態が入力中になる", async () => {
      // Given
      const { result } = renderHook(() =>
        useRoundOpStack(
          "round-1",
          { base: completed, entries: [], reflected: [] },
          faces,
        ),
      );
      expect(result.current.state.status).toBe("completed");

      // When
      act(() => {
        result.current.append(shotRecorded());
      });

      // Then
      await waitFor(() => expect(result.current.state.shots).toHaveLength(1));
      await waitFor(() =>
        expect(result.current.state.status).toBe("in_progress"),
      );
      await waitFor(() => expect(result.current.status).toBe("synced"));
      expect(JSON.stringify(send.mock.calls)).toContain(
        '"status":"in_progress"',
      );
    });

    it("ラウンド設定の変更では、完了のまま戻さない", async () => {
      // Given
      const { result } = renderHook(() =>
        useRoundOpStack(
          "round-1",
          { base: completed, entries: [], reflected: [] },
          faces,
        ),
      );

      // When
      act(() => {
        result.current.append(roundUpdated({ changes: { name: "新" } }));
      });

      // Then
      await waitFor(() =>
        expect(result.current.state.roundConfig.name).toBe("新"),
      );
      await waitFor(() => expect(result.current.status).toBe("synced"));
      expect(result.current.state.status).toBe("completed");
      expect(JSON.stringify(send.mock.calls)).not.toContain("in_progress");
    });

    it("入力中のラウンドへの記録では、状態を変える操作を積まない", async () => {
      // Given
      const { result } = renderHook(() =>
        useRoundOpStack("round-1", { base, entries: [], reflected: [] }, faces),
      );

      // When
      act(() => {
        result.current.append(shotRecorded());
      });

      // Then
      await waitFor(() => expect(result.current.status).toBe("synced"));
      expect(JSON.stringify(send.mock.calls)).not.toContain("in_progress");
      expect(result.current.state.status).toBe("in_progress");
    });
  });
});

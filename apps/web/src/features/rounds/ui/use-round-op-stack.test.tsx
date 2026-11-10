import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LoadedRound } from "@/features/rounds/application/round-handle";
import {
  createTestRounds,
  settleRoundNow,
} from "@/features/rounds/application/round-record-test-helpers";
import {
  roundBase,
  roundUpdated,
  shotRecorded,
} from "@/features/rounds/domain/round-op-test-helpers";
import { roundStreamId } from "@/features/rounds/domain/sync-events";
import { RoundDetailStoreProvider } from "@/features/rounds/ui/rounds-context";
import { useRoundOpStack } from "./use-round-op-stack";

const STREAM = roundStreamId("round-1");

const ignoreGone = () => {};

const distance = {
  id: "d-1",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
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

// 開いた材料。取得して開いたときの、最初のベースと的。
function loaded(
  status: "in_progress" | "completed" = "in_progress",
  overrides: Partial<LoadedRound> = {},
): LoadedRound {
  return {
    base: roundBase({ status, name: "元", distances: [distance] }).tables,
    targetFaces: faces as unknown as LoadedRound["targetFaces"],
    pendingCreationEventId: null,
    ...overrides,
  };
}

function setup() {
  const tab = createTestRounds();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RoundDetailStoreProvider store={tab.detail}>
      {children}
    </RoundDetailStoreProvider>
  );
  return { tab, wrapper };
}

describe("useRoundOpStack", () => {
  it("記録が空なら、画面の状態は開いたときのベースと同じで、開いている印を付ける", () => {
    // Given
    const { tab, wrapper } = setup();

    // When
    const { result } = renderHook(
      () => useRoundOpStack("round-1", loaded(), ignoreGone),
      {
        wrapper,
      },
    );

    // Then
    expect(result.current.state.roundConfig.name).toBe("元");
    expect(tab.requests.watched()).toEqual([{ roundId: "round-1" }]);
  });

  it("端末の記録にある未送信の操作を、ベースに重ねた状態から始める", async () => {
    // Given
    const { tab, wrapper } = setup();
    await tab.hub.ready();
    await tab.hub.append(STREAM, roundUpdated({ changes: { name: "未送信" } }));

    // When
    const { result } = renderHook(
      () => useRoundOpStack("round-1", loaded(), ignoreGone),
      {
        wrapper,
      },
    );

    // Then
    expect(result.current.state.roundConfig.name).toBe("未送信");
  });

  it("操作を追記すると、画面の状態へ反映する", async () => {
    // Given
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useRoundOpStack("round-1", loaded(), ignoreGone),
      {
        wrapper,
      },
    );

    // When
    act(() => {
      void result.current.append(shotRecorded());
    });

    // Then
    await waitFor(() => expect(result.current.state.shots).toHaveLength(1));
  });

  it("画面を閉じると印を外すが、追記した操作は端末の記録に残る", async () => {
    // Given
    const { tab, wrapper } = setup();
    const { result, unmount } = renderHook(
      () => useRoundOpStack("round-1", loaded(), ignoreGone),
      { wrapper },
    );
    await act(async () => {
      result.current.append(shotRecorded());
      await tab.hub.whenPersisted();
    });

    // When
    unmount();

    // Then
    expect(tab.requests.watched()).toEqual([]);
    expect(tab.hub.record(STREAM).items).toHaveLength(1);
  });

  it("StrictModeで描画しても、画面を閉じると開いている印を全て外す", () => {
    // Given
    const { tab, wrapper } = setup();
    const { unmount } = renderHook(
      () => useRoundOpStack("round-1", loaded("in_progress"), ignoreGone),
      { wrapper, reactStrictMode: true },
    );

    // When
    unmount();

    // Then
    expect(tab.requests.watched()).toEqual([]);
  });

  describe("削除の知らせ", () => {
    it("削除の印が反映されたら、onGoneを呼ぶ", async () => {
      // Given
      const { tab, wrapper } = setup();
      const onGone = vi.fn();
      renderHook(() => useRoundOpStack("round-1", loaded(), onGone), {
        wrapper,
      });

      // When
      await act(async () => {
        await tab.hub.commit(STREAM, null, 10, "user-1");
      });

      // Then
      expect(onGone).toHaveBeenCalledTimes(1);
    });

    it("別のラウンドの削除では、onGoneを呼ばない", async () => {
      // Given
      const { tab, wrapper } = setup();
      const onGone = vi.fn();
      renderHook(() => useRoundOpStack("round-1", loaded(), onGone), {
        wrapper,
      });

      // When
      await act(async () => {
        await tab.hub.commit(roundStreamId("round-2"), null, 10, "user-1");
      });

      // Then
      expect(onGone).not.toHaveBeenCalled();
    });

    it("端末のベースで開いた詳細は、取り直しでサーバーにラウンドが無いと分かったら、onGoneを呼ぶ", () => {
      // Given
      const { tab, wrapper } = setup();
      const onGone = vi.fn();
      renderHook(
        () => useRoundOpStack("round-1", loaded("in_progress"), onGone),
        { wrapper },
      );

      // When
      act(() => {
        settleRoundNow(tab.requests, "round-1", { status: "not-found" });
      });

      // Then
      expect(onGone).toHaveBeenCalledTimes(1);
    });

    it("作成が未確定のときは、取り直しでサーバーにラウンドが無いと分かっても、onGoneを呼ばない", () => {
      // Given
      const { tab, wrapper } = setup();
      const onGone = vi.fn();
      renderHook(
        () =>
          useRoundOpStack(
            "round-1",
            loaded("in_progress", { pendingCreationEventId: "pending" }),
            onGone,
          ),
        { wrapper },
      );

      // When
      act(() => {
        settleRoundNow(tab.requests, "round-1", { status: "not-found" });
      });

      // Then
      expect(onGone).not.toHaveBeenCalled();
    });
  });
});

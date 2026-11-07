import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Preset } from "../domain/preset";
import { createFakeNewRoundStore } from "./round-stores-test-helpers";
import { NewRoundStoreProvider } from "./rounds-context";
import { useStartRound } from "./use-start-round";

const fake = createFakeNewRoundStore();
const startRound = fake.store.startRound;

const preset: Preset = {
  id: "p1",
  name: "70m",
  format: "outdoor",
  bow_type: "recurve",
  preset_distances: [],
};

function setup(selected: Preset | null = null, mounted = { current: true }) {
  const hook = renderHook(() => useStartRound(selected, mounted), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(NewRoundStoreProvider, { store: fake.store, children }),
  });
  return { ...hook, mounted };
}

beforeEach(() => {
  startRound.mockReset();
  startRound.mockResolvedValue({ status: "created", roundId: "r-1" });
});

describe("useStartRound", () => {
  describe("handleStart", () => {
    it.each([
      ["プリセット未選択", null],
      ["選択中のプリセット", preset],
    ])("%sを渡してストアのstartRoundを呼ぶ", async (_name, selected) => {
      // Given
      const { result } = setup(selected);

      // When
      await act(async () => {
        await result.current.handleStart();
      });

      // Then
      expect(startRound).toHaveBeenCalledExactlyOnceWith(
        selected,
        expect.any(Function),
      );
    });

    it("渡す判定は、マウント中は真を返し、アンマウントを表す値に変わると偽を返す", async () => {
      // Given
      const { result, mounted } = setup();

      // When
      await act(async () => {
        await result.current.handleStart();
      });
      const isCurrent = startRound.mock.calls[0][1] as () => boolean;
      const whileMounted = isCurrent();
      mounted.current = false;

      // Then
      expect(whileMounted).toBe(true);
      expect(isCurrent()).toBe(false);
    });

    it("再描画を挟まない同じタスクの2回の開始でも、startRoundは1回だけ呼ぶ", async () => {
      // Given
      const pending = Promise.withResolvers<{
        status: "created";
        roundId: string;
      }>();
      startRound.mockReturnValue(pending.promise);
      const { result } = setup();

      // When
      await act(async () => {
        void result.current.handleStart();
        void result.current.handleStart();
      });

      // Then
      expect(startRound).toHaveBeenCalledTimes(1);
      expect(result.current.submitting).toBe(true);
    });

    it("createdのとき、実行中を戻さない", async () => {
      // Given
      const { result } = setup();

      // When
      await act(async () => {
        await result.current.handleStart();
      });

      // Then
      expect(result.current).toMatchObject({ submitting: true, error: null });
    });

    it("failedのとき、errorに文言を出して実行中を偽に戻し、再び開始できる", async () => {
      // Given
      startRound.mockResolvedValueOnce({ status: "failed", error: "e" });
      const { result } = setup();
      await act(async () => {
        await result.current.handleStart();
      });
      const afterFailure = { ...result.current };

      // When
      await act(async () => {
        await result.current.handleStart();
      });

      // Then
      expect(afterFailure).toMatchObject({ submitting: false, error: "e" });
      expect(startRound).toHaveBeenCalledTimes(2);
    });

    it("discardedのとき、状態を変えない", async () => {
      // Given
      startRound.mockResolvedValue({ status: "discarded" });
      const { result } = setup();

      // When
      await act(async () => {
        await result.current.handleStart();
      });

      // Then
      expect(result.current).toMatchObject({ submitting: true, error: null });
    });
  });
});

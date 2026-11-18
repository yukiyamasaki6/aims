import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCheckWait } from "./use-check-wait";

type Flow = {
  awaitingCheck: boolean;
  captchaToken: string | null;
};

type Props = { flow: Flow };

const waiting: Flow = { awaitingCheck: true, captchaToken: null };

function setup(initial: Props) {
  const dispatch = vi.fn();
  const resume = vi.fn();
  const hook = renderHook(
    ({ flow }: Props) => useCheckWait<string>({ flow, dispatch, resume }),
    { initialProps: initial },
  );
  return { dispatch, resume, ...hook };
}

describe("useCheckWait", () => {
  describe("トークンの到着での再開", () => {
    it("押すと、その入力でresumeを呼ぶ", () => {
      // Given
      const { result, resume } = setup({
        flow: { ...waiting, awaitingCheck: false },
      });

      // When
      act(() => result.current.run("first"));

      // Then
      expect(resume).toHaveBeenCalledExactlyOnceWith("first");
    });

    it("待ちの間にトークンが届くと、押した時点の入力で、1回だけ再開する", () => {
      // Given
      const { result, rerender, resume } = setup({
        flow: { ...waiting, awaitingCheck: false },
      });
      act(() => result.current.run("first"));
      rerender({ flow: waiting });
      resume.mockClear();

      // When
      rerender({ flow: { ...waiting, captchaToken: "token" } });
      rerender({ flow: { ...waiting, captchaToken: "token-2" } });

      // Then
      expect(resume).toHaveBeenCalledExactlyOnceWith("first");
    });

    it("待ちの間の再押下では、記憶した入力を更新しない", () => {
      // Given
      const { result, rerender, resume } = setup({
        flow: { ...waiting, awaitingCheck: false },
      });
      act(() => result.current.run("first"));
      rerender({ flow: waiting });
      act(() => result.current.run("second"));
      resume.mockClear();

      // When
      rerender({ flow: { ...waiting, captchaToken: "token" } });

      // Then
      expect(resume).toHaveBeenCalledExactlyOnceWith("first");
    });

    it("待ちでなければ、トークンが届いても再開しない", () => {
      // Given
      const { rerender, resume } = setup({
        flow: { ...waiting, awaitingCheck: false },
      });

      // When
      rerender({
        flow: { awaitingCheck: false, captchaToken: "token" },
      });

      // Then
      expect(resume).not.toHaveBeenCalled();
    });
  });

  describe("checkProps", () => {
    it("waitingは、待ちでトークンが無い間だけ真になる", () => {
      // Given
      const { result, rerender } = setup({ flow: waiting });
      const whileWaiting = result.current.checkProps.waiting;

      // When
      rerender({ flow: { ...waiting, captchaToken: "token" } });
      const afterToken = result.current.checkProps.waiting;
      rerender({ flow: { ...waiting, awaitingCheck: false } });

      // Then
      expect(whileWaiting).toBe(true);
      expect(afterToken).toBe(false);
      expect(result.current.checkProps.waiting).toBe(false);
    });

    it("onFailedで、待ちを解く事実を送る", () => {
      // Given
      const { dispatch, result } = setup({ flow: waiting });

      // When
      act(() => result.current.checkProps.onFailed());

      // Then
      expect(dispatch.mock.calls).toEqual([[{ type: "checkWaitReleased" }]]);
    });
  });
});

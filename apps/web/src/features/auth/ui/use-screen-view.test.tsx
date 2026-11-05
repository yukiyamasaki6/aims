import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Start } from "../domain/flow";
import { useScreenView } from "./use-screen-view";

// サインインでない汎用のreducer(加算)で、フックが特定の画面に依らないことを示す。
const add = (state: number, amount: number) => state + amount;

function setup() {
  return renderHook(() => useScreenView(add, 10));
}

describe("useScreenView", () => {
  it("初期の状態がstateと、beginの命令が受ける状態で返る", () => {
    // Given

    // When
    const { result } = setup();
    let received = 0;
    act(() => {
      result.current.view.begin((state) => {
        received = state;
        return { state, request: null } as Start<number, string>;
      });
    });

    // Then
    expect(result.current.state).toBe(10);
    expect(received).toBe(10);
  });

  it("同じタスクで続けて送った出来事が、直前の状態に順に積み重なる", () => {
    // Given
    const { result } = setup();

    // When
    act(() => {
      result.current.view.dispatch(1);
      result.current.view.dispatch(2);
      result.current.view.dispatch(3);
    });

    // Then
    expect(result.current.state).toBe(16);
  });

  it("出来事を送って描画した後のbeginの命令は、描画済みの状態を受ける", () => {
    // Given
    const { result } = setup();
    act(() => result.current.view.dispatch(5));

    // When
    let received = 0;
    act(() => {
      result.current.view.begin((state) => {
        received = state;
        return { state, request: null } as Start<number, string>;
      });
    });

    // Then
    expect(received).toBe(15);
  });

  it("再描画しても、dispatch、resetCheck、isMountedは同じ参照である", () => {
    // Given
    const { result, rerender } = setup();
    const before = result.current.view;

    // When
    rerender();
    act(() => result.current.view.dispatch(1));

    // Then
    expect(result.current.view.dispatch).toBe(before.dispatch);
    expect(result.current.view.resetCheck).toBe(before.resetCheck);
    expect(result.current.view.isMounted).toBe(before.isMounted);
  });

  it("resetCheckは、セキュリティチェックのウィジェットをやり直す", () => {
    // Given
    const { result } = setup();
    const reset = vi.fn();
    result.current.checkRef.current = { reset } as never;

    // When
    result.current.view.resetCheck();

    // Then
    expect(reset).toHaveBeenCalledOnce();
  });

  it("ウィジェットが無いときのresetCheckは、何もしない", () => {
    // Given
    const { result } = setup();

    // When
    const run = () => result.current.view.resetCheck();

    // Then
    expect(run).not.toThrow();
  });

  it("表示中の判定は、アンマウントで偽になる", () => {
    // Given
    const { result, unmount } = setup();
    const { view } = result.current;
    const before = view.isMounted();

    // When
    unmount();

    // Then
    expect(before).toBe(true);
    expect(view.isMounted()).toBe(false);
  });

  describe("begin", () => {
    const start = (state: number, amount: number): Start<number, number> =>
      state + amount > 100
        ? ({ state, request: null } as const)
        : ({
            state: state + amount,
            request: amount,
          } as const);

    it("開始できれば、結果の状態を反映し、頼む内容を返す", () => {
      // Given
      const { result } = setup();

      // When
      let request: number | null | undefined = null;
      act(() => {
        request = result.current.view.begin((state) => start(state, 5));
      });

      // Then
      expect(request).toBe(5);
      expect(result.current.state).toBe(15);
    });

    it("同じタスクの2回の開始は、どちらも描画済みの状態を見る(別のタスクの開始は、間の描画の後の状態を見る)", () => {
      // Given
      const { result } = setup();
      const received: number[] = [];
      const recording = (state: number): Start<number, string> => {
        received.push(state);
        return { state: state + 1, request: "go" };
      };

      // When
      act(() => {
        result.current.view.begin(recording);
        result.current.view.begin(recording);
      });
      act(() => {
        result.current.view.begin(recording);
      });

      // Then
      expect(received).toEqual([10, 10, 11]);
    });

    it("実行中として拒否された後に失敗の事実を送って描画すると、続くbeginが解除後の状態を受けて開始できる", () => {
      // Given
      const { result } = setup();
      const command = (state: number): Start<number, string> =>
        state > 10
          ? ({ state, request: null } as const)
          : ({ state: state + 1, request: "go" } as const);
      const results: (string | null)[] = [];
      act(() => {
        results.push(result.current.view.begin(command));
      });
      act(() => {
        results.push(result.current.view.begin(command));
      });
      act(() => result.current.view.dispatch(-5));

      // When
      let received = 0;
      act(() => {
        result.current.view.begin((state) => {
          received = state;
          return command(state);
        });
      });

      // Then
      expect(results).toEqual(["go", null]);
      expect(received).toBe(6);
      expect(result.current.state).toBe(7);
    });

    it("開始できなくても、結果の状態は反映する(不備を示す)", () => {
      // Given
      const { result } = setup();
      const invalid = (state: number): Start<number, string> =>
        ({ state: state - 1, request: null }) as const;

      // When
      let request: unknown = "unset";
      act(() => {
        request = result.current.view.begin(invalid);
      });

      // Then
      expect(request).toBeNull();
      expect(result.current.state).toBe(9);
    });
  });

  // 段階の遷移を持つ状態でも、出来事が直前の状態に順に積み重なる。
  it("段階をまたぐ出来事が、直前の状態に順に積み重なる", () => {
    // Given
    type Flow = { step: "a" | "b" | "c"; log: string[] };
    const advance = (flow: Flow, event: "next" | "back"): Flow => {
      const order = ["a", "b", "c"] as const;
      const index = order.indexOf(flow.step);
      const step = order[Math.max(0, index + (event === "next" ? 1 : -1))];
      return {
        step: step ?? flow.step,
        log: [...flow.log, `${flow.step}>${step}`],
      };
    };
    const { result } = renderHook(() =>
      useScreenView(advance, { step: "a", log: [] } as Flow),
    );

    // When
    act(() => {
      result.current.view.dispatch("next");
      result.current.view.dispatch("next");
      result.current.view.dispatch("back");
    });

    // Then
    expect(result.current.state.step).toBe("b");
    expect(result.current.state.log).toEqual(["a>b", "b>c", "c>b"]);
  });
});

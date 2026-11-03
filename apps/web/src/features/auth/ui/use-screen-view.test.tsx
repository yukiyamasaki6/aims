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
        return { kind: "invalid", state } as Start<number, string>;
      });
    });

    // Then
    expect(result.current.state).toBe(10);
    expect(received).toBe(10);
  });

  it("出来事を送った直後に、再描画を待たずbeginの命令が最新の値を受ける", () => {
    // Given
    const { result } = setup();

    // When
    let immediate = 0;
    act(() => {
      result.current.view.dispatch(5);
      result.current.view.begin((state) => {
        immediate = state;
        return { kind: "invalid", state } as Start<number, string>;
      });
    });

    // Then
    expect(immediate).toBe(15);
    expect(result.current.state).toBe(15);
  });

  it("同じタスクで続けて送った出来事が順に積み重なる", () => {
    // Given
    const { result } = setup();

    // When
    let immediate = 0;
    act(() => {
      result.current.view.dispatch(1);
      result.current.view.dispatch(2);
      result.current.view.dispatch(3);
      result.current.view.begin((state) => {
        immediate = state;
        return { kind: "invalid", state } as Start<number, string>;
      });
    });

    // Then
    expect(immediate).toBe(16);
    expect(result.current.state).toBe(16);
  });

  it("再描画してもviewは同じ", () => {
    // Given
    const { result, rerender } = setup();
    const before = result.current.view;

    // When
    rerender();
    act(() => result.current.view.dispatch(1));

    // Then
    expect(result.current.view).toBe(before);
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
        ? ({ kind: "busy", state } as const)
        : ({
            kind: "started",
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

    it("同じタスクの2回の開始で、2回目は1回目の結果の状態を見て開始しない", () => {
      // Given
      const { result } = setup();
      const startOnce = (state: number): Start<number, string> =>
        state > 10
          ? ({ kind: "busy", state } as const)
          : ({ kind: "started", state: state + 1, request: "go" } as const);

      // When
      let first: string | null | undefined = null;
      let second: string | null | undefined = null;
      const received: number[] = [];
      const recording = (state: number) => {
        received.push(state);
        return startOnce(state);
      };
      act(() => {
        first = result.current.view.begin(recording);
        second = result.current.view.begin(recording);
      });

      // Then
      expect(first).toBe("go");
      expect(second).toBeNull();
      expect(received).toEqual([10, 11]);
      expect(result.current.state).toBe(11);
    });

    it("不備で開始できなかった後の再実行が、反映後の状態を受けて開始できる", () => {
      // Given
      const { result } = setup();
      const received: number[] = [];
      const command = (state: number): Start<number, string> => {
        received.push(state);
        return state < 10
          ? ({ kind: "started", state: state + 1, request: "go" } as const)
          : ({ kind: "invalid", state: state - 1 } as const);
      };

      // When
      let first: string | null = "unset";
      let second: string | null = "unset";
      act(() => {
        first = result.current.view.begin(command);
        second = result.current.view.begin(command);
      });

      // Then
      expect(first).toBeNull();
      expect(second).toBe("go");
      expect(received).toEqual([10, 9]);
      expect(result.current.state).toBe(10);
    });

    it("実行中として拒否された後に失敗の事実を送ると、続くbeginが解除後の状態を受けて開始できる", () => {
      // Given
      const { result } = setup();
      const command = (state: number): Start<number, string> =>
        state > 10
          ? ({ kind: "busy", state } as const)
          : ({ kind: "started", state: state + 1, request: "go" } as const);

      // When
      const results: (string | null)[] = [];
      let received = 0;
      act(() => {
        results.push(result.current.view.begin(command));
        results.push(result.current.view.begin(command));
        result.current.view.dispatch(-5);
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
        ({ kind: "invalid", state: state - 1 }) as const;

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

  // 段階の遷移を持つ状態でも、出来事の積み重ねと同期した読み出しが保たれる(画面の最新の値が描画の遅れに依らない)。
  it("段階をまたぐ出来事が、再描画を待たずに積み重なり、viewは同じ参照のまま", () => {
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
    const view = result.current.view;

    // When
    let seen: Flow | undefined;
    act(() => {
      view.dispatch("next");
      view.dispatch("next");
      view.dispatch("back");
      view.begin((state) => {
        seen = state;
        return { kind: "invalid", state } as Start<Flow, string>;
      });
    });

    // Then
    expect(seen?.step).toBe("b");
    expect(seen?.log).toEqual(["a>b", "b>c", "c>b"]);
    expect(result.current.state.step).toBe("b");
    expect(result.current.view).toBe(view);
  });
});

import { vi } from "vitest";
import type { Start } from "../domain/flow";
import type { ScreenView } from "./screen-view";

// 画面の約束の偽。手続きのテストが使う。
// 実物(useScreenView)と同じく、開始の命令と出来事を実物の集約(reducer)で適用し、stateは適用した直後の値を返す。
// 送られた出来事(events)と、出来事とチェックのやり直しの順序(order)を記録する。表示中かどうかは、テストが切り替える(screen.mounted)。
export function screenHarness<State, Event extends { type: string }>(
  reducer: (state: State, event: Event) => State,
) {
  const events: Event[] = [];
  const order: string[] = [];
  const resetCheck = vi.fn(() => order.push("resetCheck"));
  const screen = { mounted: true };
  const viewOf = (initial: State): ScreenView<State, Event> => {
    let current = initial;
    return {
      get state() {
        return current;
      },
      begin<Request>(command: (state: State) => Start<State, Request>) {
        const start = command(current);
        current = start.state;
        return start.kind === "started" ? start.request : null;
      },
      dispatch: (event) => {
        events.push(event);
        order.push(event.type);
        current = reducer(current, event);
      },
      resetCheck,
      isMounted: () => screen.mounted,
    };
  };
  return { events, order, resetCheck, screen, viewOf };
}

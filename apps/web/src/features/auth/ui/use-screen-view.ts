import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { type RefObject, useRef, useState } from "react";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import type { ScreenView } from "../application/screen-view";

// 画面の状態を、集約の命令(開始)と事実(reducer)で遷移させて持ち、手続きへ渡す画面の約束を作る。
// 開始の命令は描画済みの状態に適用し、事実は直前の状態に適用する。
// 約束(view)は描画ごとに作る。dispatch、resetCheck、isMountedは描画をまたいで同じ参照で、効果の依存に使える。
// 表示中かの判定と、セキュリティチェックのウィジェットのやり直しも、ここで結ぶ。
// 約束の関数は最初の描画のものが使われるため、reducerは変わらない関数を渡す。
export function useScreenView<State, Event>(
  reducer: (state: State, event: Event) => State,
  initial: State,
): {
  state: State;
  view: ScreenView<State, Event>;
  checkRef: RefObject<TurnstileInstance | undefined>;
} {
  const mounted = useMountedRef();
  const checkRef = useRef<TurnstileInstance>(undefined);
  const [state, setState] = useState(initial);
  const [stable] = useState(() => ({
    dispatch: (event: Event) => setState((prev) => reducer(prev, event)),
    resetCheck: () => checkRef.current?.reset(),
    isMounted: () => mounted.current,
  }));
  const view: ScreenView<State, Event> = {
    ...stable,
    begin(command) {
      const start = command(state);
      setState(start.state);
      return start.kind === "started" ? start.request : null;
    },
  };
  return { state, view, checkRef };
}

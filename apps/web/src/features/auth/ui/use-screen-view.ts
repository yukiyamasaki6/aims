import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { type RefObject, useRef, useState } from "react";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import type { ScreenView } from "../application/screen-view";

// 画面の状態を、集約の命令(開始)と事実(reducer)で遷移させて持ち、手続きへ渡す画面の約束を作る。
// 最新の値をrefにも同期して持ち、命令や事実は描画を待たずに、直前の適用の結果に適用する。
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
  const latest = useRef(initial);
  const [state, setState] = useState(initial);
  const [view] = useState<ScreenView<State, Event>>(() => {
    const apply = (next: State) => {
      latest.current = next;
      setState(next);
    };
    return {
      begin(command) {
        const start = command(latest.current);
        apply(start.state);
        return start.kind === "started" ? start.request : null;
      },
      dispatch(event) {
        apply(reducer(latest.current, event));
      },
      resetCheck: () => checkRef.current?.reset(),
      isMounted: () => mounted.current,
    };
  });
  return { state, view, checkRef };
}

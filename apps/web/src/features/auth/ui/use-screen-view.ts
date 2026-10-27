import { useRef, useState } from "react";
import type { ScreenView } from "../application/screen-view";

// 画面の状態を、reducerで遷移させて持ち、手続きへ渡す画面の約束を作る。
// 最新の値をrefにも同期して持ち、`view.state`は出来事を送った直後の値を、描画を待たずに返す。
// reducer、`isMounted`、`resetCheck`は最初の描画のものを使うため、呼び出し側は変わらない関数を渡す。
export function useScreenView<State, Action>(
  reducer: (state: State, action: Action) => State,
  initial: State,
  {
    isMounted,
    resetCheck,
  }: { isMounted: () => boolean; resetCheck: () => void },
): { state: State; view: ScreenView<State, Action> } {
  const latest = useRef(initial);
  const [state, setState] = useState(initial);
  const [view] = useState<ScreenView<State, Action>>(() => ({
    get state() {
      return latest.current;
    },
    dispatch(action) {
      latest.current = reducer(latest.current, action);
      setState(latest.current);
    },
    resetCheck,
    isMounted,
  }));
  return { state, view };
}

import type { Start } from "../domain/flow";

// 1回の呼び出しの寿命。呼び出しの途中で画面が離れたかを確かめる。例外は投げない。
export type ViewLifetime = {
  isMounted(): boolean;
};

// 画面の約束。手続きが、開始の命令を描画済みの状態に適用し、事実を送り、チェックのやり直しを頼み、画面が表示中かを確かめる。例外は投げない。
// `begin`は描画済みの状態に適用する。同じタスクで続けて呼ぶと、2回目も1回目の結果を見ない(別のタスクの呼び出しは、間の描画の後の状態を見る)。
// `dispatch`は直前の状態に適用する。
export type ScreenView<State, Event> = ViewLifetime & {
  // 開始の命令を描画済みの状態に適用し、結果の状態を反映する。開始できたときだけ、頼む内容を返す(実行中と入力の不備はnull)。
  begin<Request>(
    command: (state: State) => Start<State, Request>,
  ): Request | null;
  dispatch(event: Event): void;
  resetCheck(): void;
};

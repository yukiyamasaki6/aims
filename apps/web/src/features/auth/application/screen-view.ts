import type { Start } from "../domain/flow";

// 1回の呼び出しの寿命。呼び出しの途中で画面が離れたかを確かめる。例外は投げない。
export type ViewLifetime = {
  isMounted(): boolean;
};

// 画面の約束。手続きが、画面の最新の状態を読み、開始の命令を適用し、事実を送り、チェックのやり直しを頼み、画面が表示中かを確かめる。例外は投げない。
// `state`は、命令や事実を適用した直後の値を、描画を待たずに返す。
// 同じタスクで届く2回目の呼び出しが、古い描画の値でなく、1回目の結果(送信中など)を見るため。
export type ScreenView<State, Event> = ViewLifetime & {
  readonly state: State;
  // 開始の命令を最新の状態に適用し、結果の状態を反映する。開始できたときだけ、頼む内容を返す(実行中と入力の不備はnull)。
  begin<Request>(
    command: (state: State) => Start<State, Request>,
  ): Request | null;
  dispatch(event: Event): void;
  resetCheck(): void;
};

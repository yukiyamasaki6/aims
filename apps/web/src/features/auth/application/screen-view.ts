// 画面の約束。手続きが、画面の最新の状態を読み、出来事を送り、チェックのやり直しを頼み、画面が表示中かを確かめる。
// `state`は、出来事を送った直後の値を、描画を待たずに返す。
// 同じタスクで届く2回目の呼び出しが、古い描画の値でなく、1回目の結果(送信中など)を見るため。
export type ScreenView<State, Action> = {
  readonly state: State;
  dispatch(action: Action): void;
  resetCheck(): void;
  isMounted(): boolean;
};

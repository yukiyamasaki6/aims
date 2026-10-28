// 操作の流れ(集約)が共通に使う型。4つの操作の集約が、同じ形の命令の結果を返す。

// 欄ごとのエラー。キーは欄の名前、値は利用者向けの文言。
export type FieldErrors<Field extends string> = {
  readonly [F in Field]?: string;
};

// 操作の開始の結果。どの結果も、命令を受けた後の状態(state)を持つ。
// - busy: 実行中か段階外のため、開始しない。状態は受けたまま(副作用なし)。
// - invalid: 入力に不備がある。不備を示す状態。
// - started: 開始する。実行中の状態と、認証サービスへ頼む内容(request)。
export type Start<State, Request = undefined> =
  | { readonly kind: "busy"; readonly state: State }
  | { readonly kind: "invalid"; readonly state: State }
  | {
      readonly kind: "started";
      readonly state: State;
      readonly request: Request;
    };

// 開始の後の命令の結果。新しい状態と、命令の結果。
export type Step<State, Result> = {
  readonly state: State;
  readonly result: Result;
};

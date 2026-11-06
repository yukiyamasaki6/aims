export type ReferenceKind = "target-faces" | "presets";

// 参照データ(的、プリセット)の端末への保存。保存の読み書きの失敗では投げない。`update`は渡された関数が投げたとき投げる(呼び手は純粋な`withoutPreset`だけ)。
export type ReferenceSnapshots = {
  load<T>(kind: ReferenceKind): T | null;
  save<T>(
    kind: ReferenceKind,
    userId: string,
    data: T,
    startedAt: number,
  ): void;
  // 保存済みがあるときだけ書き換える。書き換えより前に始まった取得の遅れた結果で、書き換えが戻らない。
  update<T>(kind: ReferenceKind, update: (data: T) => T): void;
};

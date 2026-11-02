export type ReferenceKind = "target-faces" | "presets";

// 参照データ(的、プリセット)の端末への保存。例外: 投げない。
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

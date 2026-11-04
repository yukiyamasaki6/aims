// クライアント/サーバー両方から参照する定数のため、"use client"境界を挟まない
// プレーンなモジュールとして分離する（"use client"ファイルの側からエクスポート
// すると、サーバーコンポーネントからはクライアント参照に置き換わってしまい、
// 配列としてそのまま使えない）。
// 選択肢は、値と並びだけを持つ。表示名は、UI層の文言の一覧が値ごとに持つ。
export const FORMAT_OPTIONS = ["outdoor", "indoor", "field"] as const;
export type FormatOption = (typeof FORMAT_OPTIONS)[number];

export const BOW_TYPE_OPTIONS = ["recurve", "compound", "barebow"] as const;
export type BowTypeOption = (typeof BOW_TYPE_OPTIONS)[number];

// ラウンド名・プリセット名は一覧・要約行のいずれも折り返し/省略に対応して
// いないため、表示崩れを防ぐ目的で上限を設ける（DB側にも同じ上限のCHECK
// 制約がある）。
export const NAME_MAX_LENGTH = 50;

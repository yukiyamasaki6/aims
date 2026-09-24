// クライアント/サーバー両方から参照する定数のため、"use client"境界を挟まない
// プレーンなモジュールとして分離する（"use client"ファイルの側からエクスポート
// すると、サーバーコンポーネントからはクライアント参照に置き換わってしまい、
// 配列としてそのまま使えない）。
export const FORMAT_OPTIONS = [
  { value: "outdoor", label: "アウトドア" },
  { value: "indoor", label: "インドア" },
  { value: "field", label: "フィールド" },
];

export const BOW_TYPE_OPTIONS = [
  { value: "recurve", label: "リカーブ" },
  { value: "compound", label: "コンパウンド" },
  { value: "barebow", label: "ベアボウ" },
];

// ラウンド名・プリセット名は一覧・要約行のいずれも折り返し/省略に対応して
// いないため、表示崩れを防ぐ目的で上限を設ける（DB側にも同じ上限のCHECK
// 制約がある）。
export const NAME_MAX_LENGTH = 50;

export function labelOf(
  options: { value: string; label: string }[],
  value: string,
) {
  return options.find((o) => o.value === value)?.label ?? value;
}

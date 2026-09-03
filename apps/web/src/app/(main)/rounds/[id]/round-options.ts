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

export function labelOf(
  options: { value: string; label: string }[],
  value: string,
) {
  return options.find((o) => o.value === value)?.label ?? value;
}

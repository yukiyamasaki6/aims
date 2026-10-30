// 選択肢の値の表示名。無ければ値のまま。
export function labelOf(
  options: { value: string; label: string }[],
  value: string,
) {
  return options.find((o) => o.value === value)?.label ?? value;
}

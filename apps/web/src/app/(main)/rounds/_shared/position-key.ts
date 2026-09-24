export function comparePositionKey(
  leftKey: string,
  leftId: string,
  rightKey: string,
  rightId: string,
): number {
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export function comparePositionKey(
  leftKey: string,
  leftId: string,
  rightKey: string,
  rightId: string,
): number {
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

// 位置キーは、最後の有効な距離のキーより大きく、最後の文字を1つ進め、`z`以上なら`a`を足す。
// 同じキーの距離は(位置キー、ID)の順で並ぶため、削除済みの距離や同時に追加した距離と同じキーでもよい。
export function nextPositionKey(key: string): string {
  const lastChar = key.charCodeAt(key.length - 1);
  if (lastChar < "z".charCodeAt(0)) {
    return key.slice(0, -1) + String.fromCharCode(lastChar + 1);
  }
  return `${key}a`;
}

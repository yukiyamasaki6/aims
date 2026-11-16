// 点数カードに出す日付。ISO形式(YYYY-MM-DD)の年月日の数字を、ロケールやタイムゾーンに頼らずスラッシュでつなぐ(ゼロ埋めのまま)。形式に合わない値は、そのまま返す。
export function formatCardDate(roundDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roundDate);
  if (match === null) return roundDate;
  return `${match[1]}/${match[2]}/${match[3]}`;
}

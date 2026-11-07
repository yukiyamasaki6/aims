// 記録の利用者と、照合する利用者の関係。
// same: 同じ。other: 別の利用者。unowned: 記録の利用者がnull(まだ誰のものでもない)。
export type RecordUserMatch = "same" | "other" | "unowned";

export function matchRecordUser(
  recordUserId: string | null,
  userId: string | null,
): RecordUserMatch {
  if (recordUserId === null) return "unowned";
  return recordUserId === userId ? "same" : "other";
}

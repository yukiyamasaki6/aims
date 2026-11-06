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

// サインインの変化への、記録の利用者の反応。
export type RecordUserReaction =
  | { type: "switch-user"; userId: string | null }
  | { type: "resume" };

// サインインの変化への反応。userIdは、サインインした利用者で、サインアウトならnull。
// サインアウトは利用者を無くす。記録の利用者と同じなら保留を再開し、別の利用者か記録の利用者がnullなら、利用者を切り替える。
export function reactionToSignIn(
  userId: string | null,
  recordUserId: string | null,
): RecordUserReaction {
  if (userId === null) return { type: "switch-user", userId: null };
  return matchRecordUser(recordUserId, userId) === "same"
    ? { type: "resume" }
    : { type: "switch-user", userId };
}

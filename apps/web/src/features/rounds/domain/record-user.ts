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
  | { type: "none" }
  | { type: "switch-user"; userId: string | null }
  | { type: "resume" };

// サインインの変化への反応。`signedOut`はサインアウト、`ignored`は利用者を判断できない変化。
// サインアウトは利用者を無くす。利用者が無い変化と判断できない変化は何もしない(オフラインで検証できないだけの可能性があるため)。
// 記録の利用者と同じなら保留を再開し、別の利用者か記録の利用者がnullなら、利用者を切り替える。
export function reactionToSignIn(
  change: { userId: string | null; signedOut: boolean; ignored: boolean },
  recordUserId: string | null,
): RecordUserReaction {
  if (change.signedOut) return { type: "switch-user", userId: null };
  if (!change.userId || change.ignored) return { type: "none" };
  return matchRecordUser(recordUserId, change.userId) === "same"
    ? { type: "resume" }
    : { type: "switch-user", userId: change.userId };
}

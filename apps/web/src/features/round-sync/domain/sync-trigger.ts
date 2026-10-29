// 取り直しの理由。open: 開いたとき、stale: 端末のベースで開いたまま、diverged: 効かなかった結果を受けた、overlay: 確定済みの操作をベースに重ねられなかった。
export type RefreshReason = "open" | "stale" | "diverged" | "overlay";

// 認証の通知。他の機能の公開の型と同じ平らな形。
type SignInChangeKind =
  | "signed-in"
  | "initial"
  | "token-refreshed"
  | "signed-out"
  | "other";
export type SignInChange = { kind: SignInChangeKind; userId: string | null };

export type SyncReaction =
  | { type: "none" }
  | { type: "switch-user"; userId: string | null }
  | { type: "resume" };

// 認証の通知への反応。`match`は、通知の利用者と記録の利用者の照合の結果。
// 照合がsameなら保留を再開し、otherとunowned(記録の利用者がnull)なら利用者を切り替える。
export function reactionTo(
  change: SignInChange,
  match: (userId: string | null) => "same" | "other" | "unowned",
): SyncReaction {
  if (change.kind === "signed-out") {
    return { type: "switch-user", userId: null };
  }
  // セッションが無い通知は、オフラインで検証できないだけの可能性があるため何もしない。
  if (!change.userId) return { type: "none" };
  if (change.kind === "other") return { type: "none" };
  return match(change.userId) === "same"
    ? { type: "resume" }
    : { type: "switch-user", userId: change.userId };
}

// 常駐の一括の取得の契機か。サインインした、開いたときの確認(利用者あり)だけ。
export function startsRefresh(change: SignInChange): boolean {
  return (
    Boolean(change.userId) &&
    (change.kind === "signed-in" || change.kind === "initial")
  );
}

// 取り直しを行うか。開いたときの依頼は常に行い、他の理由はオフラインでは行わない。
export function shouldRefetch(
  reason: RefreshReason,
  offline: boolean,
): boolean {
  return reason === "open" || !offline;
}

// 一括の取得の扱い。取得するのは、一覧の依頼があるか、常駐の前段を通ったときである。
// 反映を一覧の成否に掛けるのは、常駐の前段を通らず、一覧の依頼だけのとき。
export function refreshDecision(input: {
  resident: boolean;
  residentAllowed: boolean;
  list: boolean;
}): { fetch: boolean; waitForList: boolean } {
  const residentPassed = input.resident && input.residentAllowed;
  return {
    fetch: input.list || residentPassed,
    waitForList: input.list && !residentPassed,
  };
}

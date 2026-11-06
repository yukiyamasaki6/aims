// 取り直しを行うか。開いたときの依頼は常に行い、他の理由はオフラインでは行わない。
export function shouldRefetch(
  isOpenRequest: boolean,
  offline: boolean,
): boolean {
  return isOpenRequest || !offline;
}

// 一括の取得の扱い。常駐の契機は、前段を通ったときだけ取得して無条件に反映する。
// 一覧の依頼は、必ず取得し、一覧の取得が成功したときだけ反映する。
export function refreshDecision(
  input: { kind: "resident"; residentAllowed: boolean } | { kind: "list" },
): { fetch: boolean; waitForList: boolean } {
  if (input.kind === "list") return { fetch: true, waitForList: true };
  return { fetch: input.residentAllowed, waitForList: false };
}

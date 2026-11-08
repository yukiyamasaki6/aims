// 取り直しを行うか。開いたときの依頼は常に行い、他の理由はオフラインでは行わない。
export function shouldRefetch(
  isOpenRequest: boolean,
  offline: boolean,
): boolean {
  return isOpenRequest || !offline;
}

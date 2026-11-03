import { RETURN_TO_PARAM } from "../domain/auth-routes";

// 今の画面のクエリの遷移元の値を読む。検証しない。
export function createBrowserReturnTo() {
  return {
    read: () =>
      new URLSearchParams(window.location.search).get(RETURN_TO_PARAM),
  };
}

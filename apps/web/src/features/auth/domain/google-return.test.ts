import { describe, expect, it } from "vitest";
import {
  googleReturnOf,
  linkGoogleReturnOf,
  withoutGoogleReturn,
} from "./google-return";

const RETURN_TO = "returnTo=%2Frounds%2Fhistory%23settings%2Faccount";
const LINK_MARK = "link-google=1";

describe("googleReturnOf", () => {
  it("サインインの戻りの種類を、クエリから読む", () => {
    // Given
    // When
    const results = [
      "?code=abc",
      "?error=access_denied&error_description=denied",
      "?error=access_denied&error_code=provider_error&error_description=x",
      "?error=server_error&error_description=x",
      "?returnTo=%2Frounds",
    ].map((search) => googleReturnOf(search));

    // Then
    expect(results).toEqual([
      { kind: "code", code: "abc" },
      { kind: "cancelled" },
      { kind: "failed" },
      { kind: "failed" },
      null,
    ]);
  });

  it("別のアカウントで使用中の失敗は、取り消しや他の失敗と区別する", () => {
    // Given
    // When
    const result = googleReturnOf(
      "?error=server_error&error_code=identity_already_exists&error_description=x",
    );

    // Then
    expect(result).toEqual({ kind: "taken" });
  });
});

describe("linkGoogleReturnOf", () => {
  it("追加の戻りは、印と戻りの両方があるときだけ読む", () => {
    // Given
    // When
    const results = [
      `?${LINK_MARK}&code=x`,
      `?${LINK_MARK}&error=access_denied&error_description=denied`,
      `?${LINK_MARK}&error=server_error&error_code=identity_already_exists`,
      `?${LINK_MARK}&error=server_error`,
      "?code=x",
      `?${LINK_MARK}`,
    ].map((search) => linkGoogleReturnOf(search));

    // Then
    expect(results).toEqual([
      { kind: "code", code: "x" },
      { kind: "cancelled" },
      { kind: "taken" },
      { kind: "failed" },
      null,
      null,
    ]);
  });
});

describe("withoutGoogleReturn", () => {
  it("戻りを外したクエリは、戻りのクエリと追加の印を外し、遷移元と他のクエリを残す", () => {
    // Given
    // When
    const results = [
      `?${RETURN_TO}&code=x`,
      `?${LINK_MARK}&error=access_denied&error_description=denied`,
      `?${RETURN_TO}`,
      "",
    ].map((search) => withoutGoogleReturn(search));

    // Then
    expect(results).toEqual([`?${RETURN_TO}`, "", `?${RETURN_TO}`, ""]);
  });
});

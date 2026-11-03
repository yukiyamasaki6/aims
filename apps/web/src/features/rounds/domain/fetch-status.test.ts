import { describe, expect, it } from "vitest";
import { commFailure, FETCH_ERROR_MESSAGE } from "./fetch-status";

describe("commFailure", () => {
  it("オフラインならoffline、そうでなければ原因を断定しないerrorにする", () => {
    // Given

    // When
    const offline = commFailure(true);
    const error = commFailure(false);

    // Then
    expect(offline).toEqual({ status: "offline" });
    expect(error).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
  });
});

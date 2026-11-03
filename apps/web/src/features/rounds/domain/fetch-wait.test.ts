import { describe, expect, it } from "vitest";
import {
  FALLBACK_WAIT_MS,
  FETCH_TIMEOUT_MS,
  waitLimitMs,
  withFallback,
} from "./fetch-wait";

describe("waitLimitMs", () => {
  it("代わりがあれば短い上限、無ければ全体の上限にする", () => {
    // Given

    // When
    const withFallbackLimit = waitLimitMs(true);
    const withoutFallbackLimit = waitLimitMs(false);

    // Then
    expect(withFallbackLimit).toBe(FALLBACK_WAIT_MS);
    expect(withoutFallbackLimit).toBe(FETCH_TIMEOUT_MS);
  });
});

describe("withFallback", () => {
  it("okはそのまま返し、okでないときは代わりがあれば代わりをokで返し、無ければ元の結果を返す", () => {
    // Given
    const ok = { status: "ok", data: "取得" } as const;
    const offline = { status: "offline" } as const;

    // When
    const kept = withFallback(ok, "代わり");
    const replaced = withFallback(offline, "代わり");
    const unchanged = withFallback(offline, null);

    // Then
    expect(kept).toBe(ok);
    expect(replaced).toEqual({ status: "ok", data: "代わり" });
    expect(unchanged).toBe(offline);
  });
});

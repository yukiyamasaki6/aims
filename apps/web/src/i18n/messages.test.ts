import { afterEach, describe, expect, it, vi } from "vitest";
import { intlConfig } from "./messages";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("intlConfig", () => {
  it("ロケールはjaに固定する", () => {
    expect(intlConfig.locale).toBe("ja");
  });

  it("見つからないときは、キーを出さず空の文字列にする", () => {
    // When
    const text = intlConfig.getMessageFallback();

    // Then
    expect(text).toBe("");
  });

  it("開発時は、エラーをconsole.errorで知らせる", () => {
    // Given
    vi.stubEnv("NODE_ENV", "development");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("missing") as never;

    // When
    intlConfig.onError(error);

    // Then
    expect(spy).toHaveBeenCalledWith(error);
  });

  it("本番では、何も出さない", () => {
    // Given
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    // When
    intlConfig.onError(new Error("missing") as never);

    // Then
    expect(spy).not.toHaveBeenCalled();
  });
});

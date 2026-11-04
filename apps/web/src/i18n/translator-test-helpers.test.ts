import { describe, expect, it } from "vitest";
import { strictIntlConfig, translatorFor } from "./translator-test-helpers";

describe("translatorFor", () => {
  it("見つからないキーは例外にする", () => {
    // Given
    const t = translatorFor("shared") as unknown as (key: string) => string;

    // When
    const act = () => t("missing");

    // Then
    expect(act).toThrow();
  });

  it("書式の誤りの通知は、例外にする", () => {
    expect(() => strictIntlConfig.onError(new Error("bad"))).toThrow("bad");
  });
});

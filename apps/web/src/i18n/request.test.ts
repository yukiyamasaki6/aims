import { describe, expect, it, vi } from "vitest";
import { intlConfig } from "./messages";
import requestConfig from "./request";

// getRequestConfigはサーバーの部品専用で、Vitest(クライアントの環境)では呼べないため、設定の関数をそのまま返す境界の偽にする。
vi.mock("next-intl/server", () => ({
  getRequestConfig: (config: unknown) => config,
}));

describe("要求の設定", () => {
  it("要求によらず、文言の設定を返す", async () => {
    // Given
    const params = { requestLocale: Promise.resolve(undefined) };

    // When
    const config = await requestConfig(params);

    // Then
    expect(config).toBe(intlConfig);
  });
});

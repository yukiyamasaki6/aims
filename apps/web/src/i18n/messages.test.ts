import { createTranslator } from "use-intl/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { intlConfig } from "./messages";

type MessageTree = { readonly [key: string]: string | MessageTree };

function leafPaths(tree: MessageTree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[`${prefix}${key}`, value] as [string, string]]
      : leafPaths(value, `${prefix}${key}.`),
  );
}

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

  it("一覧の全ての本文が、書式として整形でき、空にならない", () => {
    // Given
    const t = createTranslator({
      locale: intlConfig.locale,
      messages: intlConfig.messages,
      onError: (error) => {
        throw error;
      },
    }) as unknown as (key: string, values: Record<string, string>) => string;
    const leaves = leafPaths(intlConfig.messages);

    // When
    const texts = leaves.map(([key, body]) => {
      const names = [...body.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      const values = Object.fromEntries(names.map((name) => [name, "値"]));
      return [key, t(key, values)] as const;
    });

    // Then
    expect(leaves.length).toBeGreaterThan(0);
    expect(texts.filter(([, text]) => text === "")).toEqual([]);
  });
});

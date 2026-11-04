import { render } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "./intl-test-helpers";

function Probe() {
  // 段階0では名前空間が空なので、存在しないキーを型の外から引く。
  const t = useTranslations("shared") as unknown as (key: string) => string;
  return <p>{t("missing")}</p>;
}

describe("IntlTestProvider", () => {
  it("子を描く", () => {
    const { container } = render(
      <IntlTestProvider>
        <p>子</p>
      </IntlTestProvider>,
    );

    expect(container).toHaveTextContent("子");
  });

  it("見つからないキーは、空の文字列にせず例外にする", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});

    // When
    const act = () =>
      render(
        <IntlTestProvider>
          <Probe />
        </IntlTestProvider>,
      );

    // Then
    expect(act).toThrow();
  });
});

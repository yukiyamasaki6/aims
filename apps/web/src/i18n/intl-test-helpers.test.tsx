import { render } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "./intl-test-helpers";
import { intlConfig } from "./messages";

function Probe() {
  // 段階0では名前空間が空なので、存在しないキーを型の外から引く。
  const t = useTranslations("shared") as unknown as (key: string) => string;
  return <p>{t("missing")}</p>;
}

function Shown() {
  return <p>{useTranslations("shared")("confirmDelete")}</p>;
}

function MissingValue() {
  // 差し込みの値を渡さず、書式の誤りにする。
  const t = useTranslations("rounds") as unknown as (key: string) => string;
  return <p>{t("roundTotalPoints")}</p>;
}

describe("IntlTestProvider", () => {
  it("包んだ部品が、一覧の本文を表示する", () => {
    // When
    const { container } = render(
      <IntlTestProvider>
        <Shown />
      </IntlTestProvider>,
    );

    // Then
    expect(container).toHaveTextContent(
      intlConfig.messages.shared.confirmDelete,
    );
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

  it("差し込みの値が足りないなど、書式の誤りは例外にする", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});

    // When
    const act = () =>
      render(
        <IntlTestProvider>
          <MissingValue />
        </IntlTestProvider>,
      );

    // Then
    expect(act).toThrow();
  });
});

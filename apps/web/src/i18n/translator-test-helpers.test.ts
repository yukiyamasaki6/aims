import { render } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "./intl-test-helpers";
import { strictIntlConfig, translatorFor } from "./translator-test-helpers";

describe("translatorFor", () => {
  it("名前空間とキーから本文を返し、差し込みの値を置き換える", () => {
    // Given
    const t = translatorFor("rounds");

    // When
    const plain = t("save");
    const interpolated = t("roundTotalPoints", { total: "123" });

    // Then
    expect(plain).toBe("保存");
    expect(interpolated).toBe("123点");
  });

  it("IntlTestProviderで描いた本文と同じ本文を返す(同じ設定を使う)", () => {
    // Given
    function Probe() {
      return createElement(
        "p",
        null,
        useTranslations("shared")("confirmDelete"),
      );
    }

    // When
    const { container } = render(
      createElement(IntlTestProvider, null, createElement(Probe)),
    );

    // Then
    expect(container).toHaveTextContent(
      translatorFor("shared")("confirmDelete"),
    );
  });

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

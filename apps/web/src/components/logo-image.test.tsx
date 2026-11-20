import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { LogoImage } from "./logo-image";

const sharedText = translatorFor("shared");

function renderedSize(height?: number) {
  const { unmount } = render(<LogoImage height={height} />, {
    wrapper: IntlTestProvider,
  });
  const image = screen.getByRole("img", { name: sharedText("logoAlt") });
  const size = {
    width: Number(image.getAttribute("width")),
    height: Number(image.getAttribute("height")),
  };
  unmount();
  return size;
}

describe("LogoImage", () => {
  it("指定した高さで表示し、未指定なら既定の高さで表示する", () => {
    // Given

    // When
    const specified = renderedSize(48);
    const unspecified = renderedSize();

    // Then
    expect(specified.height).toBe(48);
    expect(unspecified.height).toBeGreaterThan(0);
    expect(unspecified.height).not.toBe(specified.height);
  });

  it("高さを変えても縦横比を保つ", () => {
    // Given

    // When
    const small = renderedSize();
    const large = renderedSize(small.height * 2);

    // Then
    expect(large.width / large.height).toBeCloseTo(
      small.width / small.height,
      1,
    );
  });
});

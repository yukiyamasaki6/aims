import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { IntroHeader } from "./intro-header";

const introductionText = translatorFor("introduction");

// 押して移ることはE2E(introduction.spec.ts)が確かめる。
describe("IntroHeader", () => {
  it("ヘッダーは、bannerのランドマークとして、ロゴとサインイン・サインアップのリンクを持つ", () => {
    // Given

    // When
    render(<IntroHeader />, { wrapper: IntlTestProvider });

    // Then
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "AIMS" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      within(banner).getByRole("link", {
        name: introductionText("headerSignIn"),
      }),
    ).toHaveAttribute("href", "/signin");
    expect(
      within(banner).getByRole("link", {
        name: introductionText("headerSignUp"),
      }),
    ).toHaveAttribute("href", "/signup");
  });

  it("ヘッダーは見出しを持たない", () => {
    // Given

    // When
    render(<IntroHeader />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});

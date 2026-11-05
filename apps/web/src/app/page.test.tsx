import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import Home from "./page";

const navigationText = translatorFor("navigation");

describe("Home", () => {
  it("紹介画面の見出しと、/signupへの開始リンクを表示する", () => {
    // Given

    // When
    render(<Home />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByRole("heading", { name: "AIMS" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: navigationText("startButton") }),
    ).toHaveAttribute("href", "/signup");
  });
});

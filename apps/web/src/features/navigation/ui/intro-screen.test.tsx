import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { IntroScreen } from "./intro-screen";

const navigationText = translatorFor("navigation");

describe("IntroScreen", () => {
  it("アプリ名と説明文、開始リンク、AIMSロゴを表示し、開始リンクはサインアップの画面を向く", () => {
    // Given

    // When
    render(<IntroScreen />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByRole("heading", { name: "AIMS" })).toBeInTheDocument();
    expect(
      screen.getByText(navigationText("introDescription")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: navigationText("startButton") }),
    ).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "AIMS" })).toBeInTheDocument();
  });
});

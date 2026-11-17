import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import Home from "./page";

const introductionText = translatorFor("introduction");

describe("Home", () => {
  // リンクの件数と行き先は、紹介画面の部品のテストが確かめる。
  it("入口は、引数や認証の状態を使わずに、紹介画面の見出しを表示する", () => {
    // Given

    // When
    render(<Home />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: introductionText("catch"),
      }),
    ).toBeInTheDocument();
  });
});

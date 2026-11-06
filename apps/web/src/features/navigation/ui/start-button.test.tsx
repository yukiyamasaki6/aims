import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { StartButton } from "./start-button";

const navigationText = translatorFor("navigation");

describe("StartButton", () => {
  // 押して移ることはE2E(navigation.spec.ts)が確かめる。
  it("渡された行き先を、開始リンクの行き先にする", () => {
    // Given

    // When
    render(<StartButton href="/signup" />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("link", { name: navigationText("startButton") }),
    ).toHaveAttribute("href", "/signup");
  });
});

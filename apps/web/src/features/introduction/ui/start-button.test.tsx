import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { StartButton } from "./start-button";

const introductionText = translatorFor("introduction");

describe("StartButton", () => {
  // 押して移ることはE2E(introduction.spec.ts)が確かめる。
  it("開始リンクは、名前が「記録を始める」で、サインアップの画面を向く", () => {
    // Given

    // When
    render(<StartButton />, { wrapper: IntlTestProvider });

    // Then
    expect(
      screen.getByRole("link", { name: introductionText("startButton") }),
    ).toHaveAttribute("href", "/signup");
  });
});

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { SignUpForm } from "./signup-form";

it("登録の見出しを共通フォームに渡す", () => {
  // Given
  const signUp = {
    sendCode: vi.fn(),
    verifyCode: vi.fn(),
    tickCooldown: vi.fn(),
  };
  // When
  render(<SignUpForm signUp={signUp} siteKey="site-key" />, {
    wrapper: IntlTestProvider,
  });
  // Then
  expect(
    screen.getByRole("heading", { name: translatorFor("auth")("signUpTitle") }),
  ).toBeVisible();
});

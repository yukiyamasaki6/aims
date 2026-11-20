import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { SignInForm } from "./signin-form";

it("見出しを持たず、送付ボタンを「メールで続ける」で共通フォームに渡す", () => {
  // Given
  const signIn = {
    sendCode: vi.fn(),
    verifyCode: vi.fn(),
    tickCooldown: vi.fn(),
  };

  // When
  render(
    <SignInForm signIn={signIn} siteKey="site-key" readReturnTo={() => null} />,
    { wrapper: IntlTestProvider },
  );

  // Then
  expect(
    screen.getByRole("button", {
      name: translatorFor("auth")("emailContinue"),
    }),
  ).toBeVisible();
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
});

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { SignInForm } from "./signin-form";

it("ログインの見出しを共通フォームに渡す", () => {
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
    screen.getByRole("heading", { name: translatorFor("auth")("signInTitle") }),
  ).toBeVisible();
});

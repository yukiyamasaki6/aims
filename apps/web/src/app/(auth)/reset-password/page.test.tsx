import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "./page";

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックする。
vi.mock("../_shared/turnstile", () => ({
  Turnstile: () => <div data-testid="turnstile-stub" />,
}));

describe("ResetPasswordPage", () => {
  it("パスワード再設定フォームを表示する", () => {
    // Given
    // When
    render(<ResetPasswordPage />);

    // Then
    expect(
      screen.getByRole("heading", { name: "パスワードを再設定" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "認証コードを送信" }),
    ).toBeInTheDocument();
  });
});

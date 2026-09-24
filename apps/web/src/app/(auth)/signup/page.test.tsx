import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SignUpPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Server Actionはクライアントから見るとサーバーとの通信のため、境界としてモックする。
vi.mock("./actions", () => ({
  isEmailRegistered: vi.fn(),
}));

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックする。
vi.mock("../_shared/turnstile", () => ({
  Turnstile: () => <div data-testid="turnstile-stub" />,
}));

describe("SignUpPage", () => {
  it("サインアップフォームを表示する", () => {
    // Given
    // When
    render(<SignUpPage />);

    // Then
    expect(
      screen.getByRole("heading", { name: "サインアップ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "認証コードを送信" }),
    ).toBeInTheDocument();
  });
});

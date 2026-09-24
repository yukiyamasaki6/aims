import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SignInPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックする。
vi.mock("../_shared/turnstile", () => ({
  Turnstile: () => <div data-testid="turnstile-stub" />,
}));

describe("SignInPage", () => {
  it("サインインフォームを表示する", () => {
    // Given
    // When
    render(<SignInPage />);

    // Then
    expect(
      screen.getByRole("heading", { name: "サインイン" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "サインイン" }),
    ).toBeInTheDocument();
  });
});

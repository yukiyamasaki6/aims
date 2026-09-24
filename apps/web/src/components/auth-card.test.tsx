import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthCard } from "./auth-card";

describe("AuthCard", () => {
  it("renders the title and children", () => {
    render(
      <AuthCard title="サインイン">
        <p>content</p>
      </AuthCard>,
    );
    expect(screen.getByText("サインイン")).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(
      <AuthCard title="サインイン" description="説明文">
        <p>content</p>
      </AuthCard>,
    );
    expect(screen.getByText("説明文")).toBeInTheDocument();
  });

  it("does not render a back button when onBack is not provided", () => {
    render(
      <AuthCard title="サインイン">
        <p>content</p>
      </AuthCard>,
    );
    expect(
      screen.queryByRole("button", { name: /戻る/ }),
    ).not.toBeInTheDocument();
  });

  it("calls onBack when the back button is clicked", async () => {
    const handleBack = vi.fn();
    const user = userEvent.setup();
    render(
      <AuthCard title="サインイン" onBack={handleBack}>
        <p>content</p>
      </AuthCard>,
    );

    await user.click(screen.getByRole("button", { name: /戻る/ }));

    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it("marks the back button as aria-disabled when backDisabled is true", () => {
    // Given
    const handleBack = vi.fn();

    // When
    render(
      <AuthCard title="サインイン" onBack={handleBack} backDisabled>
        <p>content</p>
      </AuthCard>,
    );

    // Then
    expect(screen.getByRole("button", { name: /戻る/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it.each([
    { label: "false", backDisabled: false },
    { label: "omitted", backDisabled: undefined },
  ])(
    "does not mark the back button as aria-disabled when backDisabled is $label",
    ({ backDisabled }) => {
      // Given
      const handleBack = vi.fn();

      // When
      render(
        <AuthCard
          title="サインイン"
          onBack={handleBack}
          backDisabled={backDisabled}
        >
          <p>content</p>
        </AuthCard>,
      );

      // Then
      expect(screen.getByRole("button", { name: /戻る/ })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    },
  );

  it("still calls onBack when backDisabled is true (suppressing the action is the caller's responsibility)", async () => {
    // Given
    const handleBack = vi.fn();
    const user = userEvent.setup();
    render(
      <AuthCard title="サインイン" onBack={handleBack} backDisabled>
        <p>content</p>
      </AuthCard>,
    );

    // When
    await user.click(screen.getByRole("button", { name: /戻る/ }));

    // Then
    expect(handleBack).toHaveBeenCalledTimes(1);
  });
});

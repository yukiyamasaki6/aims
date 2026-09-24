import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AuthLayout from "./layout";

describe("AuthLayout", () => {
  it("子要素をmain要素の中に表示する", () => {
    // Given
    const children = <p>子要素</p>;

    // When
    render(<AuthLayout>{children}</AuthLayout>);

    // Then
    expect(screen.getByRole("main")).toContainElement(
      screen.getByText("子要素"),
    );
  });
});

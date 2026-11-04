import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import AuthLayout from "./layout";

describe("AuthLayout", () => {
  it("子要素をmain要素の中に表示する", () => {
    // Given

    // When
    const children = <p>子要素</p>;
    render(<AuthLayout>{children}</AuthLayout>, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getByRole("main")).toContainElement(
      screen.getByText("子要素"),
    );
  });
});

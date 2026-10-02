import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppLogo } from "./app-logo";

describe("AppLogo", () => {
  it("AIMSを/へのリンクとして表示する", () => {
    // Given
    // When
    render(<AppLogo />);

    // Then
    expect(screen.getByRole("link", { name: "AIMS" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

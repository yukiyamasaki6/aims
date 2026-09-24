import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OfflinePage from "./page";

describe("OfflinePage", () => {
  it("オフラインであることを表示する", () => {
    // Given
    // When
    render(<OfflinePage />);

    // Then
    expect(
      screen.getByRole("heading", { name: "オフラインです" }),
    ).toBeInTheDocument();
  });
});

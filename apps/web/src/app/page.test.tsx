import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("アプリの紹介と、サインアップへの開始リンクを表示する", () => {
    // Given
    // When
    render(<Home />);

    // Then
    expect(screen.getByRole("heading", { name: "AIMS" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開始" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });
});

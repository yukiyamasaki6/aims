import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Home from "./page";

vi.mock("./start-button", () => ({
  StartButton: () => <a href="/signup">開始</a>,
}));

describe("Home", () => {
  it("アプリの紹介と、開始ボタンと、/へのAIMSロゴを表示する", () => {
    // Given
    // When
    render(<Home />);

    // Then
    expect(screen.getByRole("heading", { name: "AIMS" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開始" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AIMS" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

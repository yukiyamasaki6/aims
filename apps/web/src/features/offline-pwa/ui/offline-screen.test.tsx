import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfflineScreen } from "./offline-screen";

describe("OfflineScreen", () => {
  it("オフラインであることと、接続を確認する案内を表示する", () => {
    // Given
    // When
    render(<OfflineScreen />);

    // Then
    expect(
      screen.getByRole("heading", { name: "オフラインです" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "インターネットに接続されていません。接続を確認してから、もう一度お試しください。",
      ),
    ).toBeInTheDocument();
  });

  it("AIMSロゴのリンクを表示する", () => {
    // Given
    // When
    render(<OfflineScreen />);

    // Then
    expect(screen.getByRole("link", { name: "AIMS" })).toBeInTheDocument();
  });
});

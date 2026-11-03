import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  describe("表示", () => {
    it("data-slotを付与した枠を表示する", () => {
      // Given
      const testId = "frame";

      // When
      render(<Skeleton data-testid={testId} />);

      // Then
      const frame = screen.getByTestId(testId);
      expect(frame).toHaveAttribute("data-slot", "skeleton");
    });

    it("指定したクラスを付与する", () => {
      // Given
      const testId = "frame";

      // When
      render(<Skeleton data-testid={testId} className="h-5 w-24 rounded" />);

      // Then
      const frame = screen.getByTestId(testId);
      expect(frame).toHaveClass("h-5", "w-24", "rounded");
    });
  });
});

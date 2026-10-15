import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  describe("表示", () => {
    it("data-slotを付与し、共通の波のクラスを持つ枠を表示する", () => {
      // Given
      const testId = "frame";

      // When
      render(<Skeleton data-testid={testId} />);

      // Then
      const frame = screen.getByTestId(testId);
      expect(frame).toHaveAttribute("data-slot", "skeleton");
      expect(frame).toHaveClass("skeleton");
    });

    it("指定したクラスを残し、点滅のクラスを持たない", () => {
      // Given
      const testId = "frame";

      // When
      render(<Skeleton data-testid={testId} className="h-5 w-24 rounded" />);

      // Then
      const frame = screen.getByTestId(testId);
      expect(frame).toHaveClass("skeleton", "h-5", "w-24", "rounded");
      expect(frame).not.toHaveClass("animate-pulse");
    });
  });
});

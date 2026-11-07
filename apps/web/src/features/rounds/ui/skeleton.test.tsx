import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  describe("表示", () => {
    it("指定したクラスを付与する", () => {
      // Given
      const testId = "frame";

      // When
      render(<Skeleton data-testid={testId} className="h-5 w-24 rounded" />, {
        wrapper: IntlTestProvider,
      });

      // Then
      const frame = screen.getByTestId(testId);
      expect(frame).toHaveClass("h-5", "w-24", "rounded");
    });
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompleteRoundBar } from "./complete-round-bar";

describe("CompleteRoundBar", () => {
  describe("表示", () => {
    it("入力中は入力を完了するボタンを表示する", () => {
      // Given / When
      render(
        <CompleteRoundBar
          status="in_progress"
          confirmation={null}
          onComplete={vi.fn()}
        />,
      );

      // Then
      expect(screen.getByTestId("complete-round-button")).toHaveTextContent(
        "入力を完了する",
      );
    });

    it("完了のときは何も表示しない", () => {
      // Given / When
      const { container } = render(
        <CompleteRoundBar
          status="completed"
          confirmation={null}
          onComplete={vi.fn()}
        />,
      );

      // Then
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("ボタンを押したとき", () => {
    it("確認の文言がなければ、確認なしで完了にする", async () => {
      // Given
      const onComplete = vi.fn();
      render(
        <CompleteRoundBar
          status="in_progress"
          confirmation={null}
          onComplete={onComplete}
        />,
      );

      // When
      await userEvent.click(screen.getByTestId("complete-round-button"));

      // Then
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
    });

    it("確認の文言があれば、確認を出し、確認するまで完了にしない", async () => {
      // Given
      const onComplete = vi.fn();
      render(
        <CompleteRoundBar
          status="in_progress"
          confirmation="未入力のマスがあります。入力を完了しますか？"
          onComplete={onComplete}
        />,
      );

      // When
      await userEvent.click(screen.getByTestId("complete-round-button"));

      // Then
      expect(
        screen.getByText("未入力のマスがあります。入力を完了しますか？"),
      ).toBeInTheDocument();
      expect(onComplete).not.toHaveBeenCalled();

      // When
      await userEvent.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("渡された文言で確認を出す", async () => {
      // Given
      render(
        <CompleteRoundBar
          status="in_progress"
          confirmation="記録がありません。入力を完了しますか？"
          onComplete={vi.fn()}
        />,
      );

      // When
      await userEvent.click(screen.getByTestId("complete-round-button"));

      // Then
      expect(
        screen.getByText("記録がありません。入力を完了しますか？"),
      ).toBeInTheDocument();
    });

    it("確認でキャンセルすると完了にしない", async () => {
      // Given
      const onComplete = vi.fn();
      render(
        <CompleteRoundBar
          status="in_progress"
          confirmation="未入力のマスがあります。入力を完了しますか？"
          onComplete={onComplete}
        />,
      );
      await userEvent.click(screen.getByTestId("complete-round-button"));

      // When
      await userEvent.click(screen.getByTestId("confirm-dialog-cancel"));

      // Then
      expect(onComplete).not.toHaveBeenCalled();
      expect(screen.getByTestId("complete-round-button")).toBeInTheDocument();
    });
  });
});

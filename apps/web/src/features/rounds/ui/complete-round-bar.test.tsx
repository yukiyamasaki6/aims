import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { CompleteRoundBar } from "./complete-round-bar";

const roundsText = translatorFor("rounds");

describe("CompleteRoundBar", () => {
  describe("表示", () => {
    it("入力中は入力を完了するボタンを表示する", () => {
      // Given
      // When
      render(
        <CompleteRoundBar
          status="in_progress"
          confirmation={null}
          onComplete={vi.fn()}
        />,
        { wrapper: IntlTestProvider },
      );

      // Then
      expect(screen.getByTestId("complete-round-button")).toHaveTextContent(
        roundsText("completeRound"),
      );
    });

    it("完了のときは何も表示しない", () => {
      // Given
      // When
      const { container } = render(
        <CompleteRoundBar
          status="completed"
          confirmation={null}
          onComplete={vi.fn()}
        />,
        { wrapper: IntlTestProvider },
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
        { wrapper: IntlTestProvider },
      );

      // When
      await userEvent.click(screen.getByTestId("complete-round-button"));

      // Then
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
    });

    it("確認の文言があれば、押すと確認を出し、まだ完了にしない", async () => {
      // Given
      const onComplete = vi.fn();
      render(
        <CompleteRoundBar
          status="in_progress"
          confirmation="unfilledCells"
          onComplete={onComplete}
        />,
        { wrapper: IntlTestProvider },
      );

      // When
      await userEvent.click(screen.getByTestId("complete-round-button"));

      // Then
      expect(
        screen.getByText(roundsText("completionConfirmation.unfilledCells")),
      ).toBeInTheDocument();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("確認で完了するを選ぶと完了にする", async () => {
      // Given
      const onComplete = vi.fn();
      render(
        <CompleteRoundBar
          status="in_progress"
          confirmation="unfilledCells"
          onComplete={onComplete}
        />,
        { wrapper: IntlTestProvider },
      );
      await userEvent.click(screen.getByTestId("complete-round-button"));

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
          confirmation="noRecords"
          onComplete={vi.fn()}
        />,
        { wrapper: IntlTestProvider },
      );

      // When
      await userEvent.click(screen.getByTestId("complete-round-button"));

      // Then
      expect(
        screen.getByText(roundsText("completionConfirmation.noRecords")),
      ).toBeInTheDocument();
    });

    it("確認でキャンセルすると完了にしない", async () => {
      // Given
      const onComplete = vi.fn();
      render(
        <CompleteRoundBar
          status="in_progress"
          confirmation="unfilledCells"
          onComplete={onComplete}
        />,
        { wrapper: IntlTestProvider },
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

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, type Mock, vi } from "vitest";
import { BlockingConfirmDialog, ConfirmDialog } from "./confirm-dialog";
import { Dialog, DialogContent } from "./dialog";

function cancelButton() {
  return screen.getByRole("button", { name: "キャンセル" });
}

function confirmButton(name = "削除") {
  return screen.getByRole("button", { name });
}

// Dialogから通知された開閉状態（第1引数）だけを取り出す。
function openStates(handleOpenChange: Mock) {
  return handleOpenChange.mock.calls.map(([open]) => open);
}

// onConfirmの完了を任意のタイミングで制御するためのPromise。
function deferred() {
  let resolve: (value: { error: string } | undefined) => void = () => {};
  const promise = new Promise<{ error: string } | undefined>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("ConfirmDialog", () => {
  describe("表示", () => {
    it("openがtrueの場合、説明文とキャンセル・確認ボタンをダイアログに表示する", () => {
      // Given
      const description = "この距離を削除しますか？";

      // When
      render(
        <ConfirmDialog
          open
          onOpenChange={vi.fn()}
          description={description}
          onConfirm={vi.fn()}
        />,
      );

      // Then
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("この距離を削除しますか？");
      expect(cancelButton()).toBeInTheDocument();
      expect(confirmButton("削除")).toBeInTheDocument();
    });

    it("openがfalseの場合、ダイアログを表示しない", () => {
      // Given
      const description = "この距離を削除しますか？";

      // When
      render(
        <ConfirmDialog
          open={false}
          onOpenChange={vi.fn()}
          description={description}
          onConfirm={vi.fn()}
        />,
      );

      // Then
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    describe("confirmLabel", () => {
      it("指定した場合、確認ボタンに指定した文言を表示する", () => {
        // Given
        const confirmLabel = "破棄";

        // When
        render(
          <ConfirmDialog
            open
            onOpenChange={vi.fn()}
            description="説明"
            confirmLabel={confirmLabel}
            onConfirm={vi.fn()}
          />,
        );

        // Then
        expect(confirmButton("破棄")).toBeInTheDocument();
      });
    });
  });

  describe("確認ボタンのクリック", () => {
    it("ダイアログを閉じ、onConfirmを呼び出す", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const handleConfirm = vi.fn();
      const user = userEvent.setup();
      render(
        <ConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={handleConfirm}
        />,
      );

      // When
      await user.click(confirmButton());

      // Then
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      expect(handleConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe("キャンセルボタンのクリック", () => {
    it("ダイアログを閉じ、onConfirmを呼び出さない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const handleConfirm = vi.fn();
      const user = userEvent.setup();
      render(
        <ConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={handleConfirm}
        />,
      );

      // When
      await user.click(cancelButton());

      // Then
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      expect(handleConfirm).not.toHaveBeenCalled();
    });
  });

  describe("Escキー", () => {
    it("ダイアログを閉じ、onConfirmを呼び出さない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const handleConfirm = vi.fn();
      const user = userEvent.setup();
      render(
        <ConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={handleConfirm}
        />,
      );

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(openStates(handleOpenChange)).toEqual([false]);
      expect(handleConfirm).not.toHaveBeenCalled();
    });
  });

  // 他のDialogの中から開かれた場合の、ダイアログ外のクリック。
  describe("ネストしたダイアログ外のクリック", () => {
    it("nestedがtrueの場合、ダイアログを閉じる", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const user = userEvent.setup();
      render(
        <Dialog open>
          <DialogContent>
            外側
            <ConfirmDialog
              open
              onOpenChange={handleOpenChange}
              description="説明"
              onConfirm={vi.fn()}
              nested
            />
          </DialogContent>
        </Dialog>,
      );
      const backdrops = document.querySelectorAll(".bg-black\\/40");

      // When
      await user.click(backdrops[backdrops.length - 1]);

      // Then
      expect(openStates(handleOpenChange)).toEqual([false]);
    });
  });
});

describe("BlockingConfirmDialog", () => {
  describe("表示", () => {
    it("openがtrueの場合、説明文と操作可能なキャンセル・確認ボタンをダイアログに表示する", () => {
      // Given
      const description = "このラウンドを削除しますか？";

      // When
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={vi.fn()}
          description={description}
          onConfirm={vi.fn()}
        />,
      );

      // Then
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "このラウンドを削除しますか？",
      );
      expect(cancelButton()).toHaveAttribute("aria-disabled", "false");
      expect(confirmButton("削除")).toHaveAttribute("aria-disabled", "false");
    });

    it("openがfalseの場合、ダイアログを表示しない", () => {
      // Given
      const description = "このラウンドを削除しますか？";

      // When
      render(
        <BlockingConfirmDialog
          open={false}
          onOpenChange={vi.fn()}
          description={description}
          onConfirm={vi.fn()}
        />,
      );

      // Then
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    describe("confirmLabel", () => {
      it("指定した場合、確認ボタンに指定した文言を表示する", () => {
        // Given
        const confirmLabel = "破棄";

        // When
        render(
          <BlockingConfirmDialog
            open
            onOpenChange={vi.fn()}
            description="説明"
            confirmLabel={confirmLabel}
            onConfirm={vi.fn()}
          />,
        );

        // Then
        expect(confirmButton("破棄")).toBeInTheDocument();
      });
    });
  });

  describe("確認ボタンのクリック", () => {
    it("完了を待つ間、ダイアログを開いたままボタンを操作不可として表示する", () => {
      // Given
      const handleOpenChange = vi.fn();
      const request = deferred();
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={() => request.promise}
        />,
      );

      // When
      fireEvent.click(confirmButton());

      // Then
      expect(handleOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(cancelButton()).toHaveAttribute("aria-disabled", "true");
      expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
      expect(confirmButton().querySelector("svg")).not.toBeNull();
    });

    it("成功した場合、ダイアログを閉じる", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const handleConfirm = vi.fn(async () => undefined);
      const user = userEvent.setup();
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={handleConfirm}
        />,
      );

      // When
      await user.click(confirmButton());

      // Then
      expect(handleConfirm).toHaveBeenCalledTimes(1);
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      expect(confirmButton()).toHaveAttribute("aria-disabled", "false");
    });

    it("失敗した場合、ダイアログを開いたままエラーを表示し、ボタンを操作可能に戻す", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const user = userEvent.setup();
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={async () => ({ error: "削除に失敗しました" })}
        />,
      );

      // When
      await user.click(confirmButton());

      // Then
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "削除に失敗しました",
      );
      expect(handleOpenChange).not.toHaveBeenCalled();
      expect(cancelButton()).toHaveAttribute("aria-disabled", "false");
      expect(confirmButton()).toHaveAttribute("aria-disabled", "false");
      expect(confirmButton().querySelector("svg")).toBeNull();
    });

    it("失敗後に再試行した場合、エラーを消して再度onConfirmを呼び出す", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const retry = deferred();
      const handleConfirm = vi
        .fn<() => Promise<{ error: string } | undefined>>()
        .mockResolvedValueOnce({ error: "削除に失敗しました" })
        .mockReturnValueOnce(retry.promise);
      const user = userEvent.setup();
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={handleConfirm}
        />,
      );
      await user.click(confirmButton());

      // When
      await user.click(confirmButton());

      // Then
      expect(handleConfirm).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("削除に失敗しました")).not.toBeInTheDocument();
      await act(async () => retry.resolve(undefined));
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    });

    it("完了前に連続で押した場合、onConfirmを1回だけ呼び出す", () => {
      // Given
      const handleConfirm = vi.fn(() => deferred().promise);
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={vi.fn()}
          description="説明"
          onConfirm={handleConfirm}
        />,
      );

      // When
      fireEvent.click(confirmButton());
      fireEvent.click(confirmButton());

      // Then
      expect(handleConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe("キャンセルボタンのクリック", () => {
    it("ダイアログを閉じ、onConfirmを呼び出さない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const handleConfirm = vi.fn();
      const user = userEvent.setup();
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={handleConfirm}
        />,
      );

      // When
      await user.click(cancelButton());

      // Then
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      expect(handleConfirm).not.toHaveBeenCalled();
    });

    it("完了を待つ間は、ダイアログを閉じない", () => {
      // Given
      const handleOpenChange = vi.fn();
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={() => deferred().promise}
        />,
      );
      fireEvent.click(confirmButton());

      // When
      fireEvent.click(cancelButton());

      // Then
      expect(handleOpenChange).not.toHaveBeenCalled();
    });
  });

  describe("Escキー", () => {
    it("ダイアログを閉じ、表示中のエラーを消す", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const user = userEvent.setup();
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={async () => ({ error: "削除に失敗しました" })}
        />,
      );
      await user.click(confirmButton());

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(openStates(handleOpenChange)).toEqual([false]);
      expect(screen.queryByText("削除に失敗しました")).not.toBeInTheDocument();
    });

    it("完了を待つ間は、ダイアログを閉じない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const user = userEvent.setup();
      render(
        <BlockingConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={() => deferred().promise}
        />,
      );
      fireEvent.click(confirmButton());

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(handleOpenChange).not.toHaveBeenCalled();
    });
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
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

// 最前面のダイアログの背景（ダイアログ外のクリック先）。見た目のクラスでなく、base-uiのBackdropが付ける属性で探す。
function backdrop() {
  const backdrops = document.querySelectorAll(
    '[role="presentation"][data-open]',
  );
  return backdrops[backdrops.length - 1];
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

  describe("confirmVariant", () => {
    it("未指定の場合、確認ボタンは破壊的な見た目になる", () => {
      // Given

      // When
      render(
        <ConfirmDialog
          open
          onOpenChange={vi.fn()}
          description="説明"
          onConfirm={vi.fn()}
        />,
      );

      // Then
      expect(confirmButton()).toHaveClass("text-destructive");
    });

    it("defaultを指定した場合、確認ボタンは破壊的な見た目にならない", () => {
      // Given

      // When
      render(
        <ConfirmDialog
          open
          onOpenChange={vi.fn()}
          description="説明"
          confirmLabel="完了する"
          confirmVariant="default"
          onConfirm={vi.fn()}
        />,
      );

      // Then
      expect(confirmButton("完了する")).not.toHaveClass("text-destructive");
      expect(confirmButton("完了する")).toHaveClass("bg-primary");
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

  describe("ダイアログ外のクリック", () => {
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
      await user.click(backdrop());

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

// 実行中とエラーは呼び出し側が持つため、この部品には状態として渡す。
function renderBlocking({
  busy = false,
  error = null,
  ...props
}: Partial<ComponentProps<typeof BlockingConfirmDialog>> = {}) {
  return render(
    <BlockingConfirmDialog
      open
      onOpenChange={vi.fn()}
      description="説明"
      onConfirm={vi.fn()}
      busy={busy}
      error={error}
      {...props}
    />,
  );
}

describe("BlockingConfirmDialog", () => {
  describe("表示", () => {
    it("openがtrueの場合、説明文と操作可能なキャンセル・確認ボタンをダイアログに表示する", () => {
      // Given

      // When
      renderBlocking({ description: "このラウンドを削除しますか？" });

      // Then
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "このラウンドを削除しますか？",
      );
      expect(cancelButton()).toHaveAttribute("aria-disabled", "false");
      expect(confirmButton("削除")).toHaveAttribute("aria-disabled", "false");
    });

    it("openがfalseの場合、ダイアログを表示しない", () => {
      // Given

      // When
      renderBlocking({ open: false });

      // Then
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    describe("confirmLabel", () => {
      it("指定した場合、確認ボタンに指定した文言を表示する", () => {
        // Given

        // When
        renderBlocking({ confirmLabel: "破棄" });

        // Then
        expect(confirmButton("破棄")).toBeInTheDocument();
      });
    });

    it("errorがあれば、ダイアログ内にエラーを表示する", () => {
      // Given

      // When
      renderBlocking({ error: "削除に失敗しました" });

      // Then
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "削除に失敗しました",
      );
    });

    it("errorがnullなら、エラーを表示しない", () => {
      // Given

      // When
      renderBlocking({ error: null });

      // Then
      expect(screen.getByRole("dialog")).not.toHaveTextContent(
        "削除に失敗しました",
      );
    });
  });

  describe("実行中(busy)の表示", () => {
    it("ダイアログを開いたままボタンを操作不可として表示し、確認ボタンにスピナーを出す", () => {
      // Given

      // When
      renderBlocking({ busy: true });

      // Then
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(cancelButton()).toHaveAttribute("aria-disabled", "true");
      expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
      expect(confirmButton().querySelector("svg")).not.toBeNull();
      expect(cancelButton().querySelector("svg")).toBeNull();
    });

    it("実行中でなければ、ボタンを操作可能に表示し、スピナーを出さない", () => {
      // Given

      // When
      renderBlocking({ busy: false, error: "削除に失敗しました" });

      // Then
      expect(cancelButton()).toHaveAttribute("aria-disabled", "false");
      expect(confirmButton()).toHaveAttribute("aria-disabled", "false");
      expect(confirmButton().querySelector("svg")).toBeNull();
    });
  });

  describe("確認ボタンのクリック", () => {
    it("onConfirmを押下のたびにそのまま呼び出し、ダイアログの開閉は知らせない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const handleConfirm = vi.fn();
      const user = userEvent.setup();
      renderBlocking({
        onOpenChange: handleOpenChange,
        onConfirm: handleConfirm,
      });

      // When
      await user.click(confirmButton());
      await user.click(confirmButton());

      // Then
      expect(handleConfirm).toHaveBeenCalledTimes(2);
      expect(handleOpenChange).not.toHaveBeenCalled();
    });
  });

  describe("キャンセルボタンのクリック", () => {
    it("ダイアログを閉じ、onConfirmを呼び出さない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const handleConfirm = vi.fn();
      const user = userEvent.setup();
      renderBlocking({
        onOpenChange: handleOpenChange,
        onConfirm: handleConfirm,
      });

      // When
      await user.click(cancelButton());

      // Then
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      expect(handleConfirm).not.toHaveBeenCalled();
    });

    it("完了を待つ間は、ダイアログを閉じない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const user = userEvent.setup();
      renderBlocking({ busy: true, onOpenChange: handleOpenChange });

      // When
      await user.click(cancelButton());

      // Then
      expect(handleOpenChange).not.toHaveBeenCalled();
    });
  });

  describe("ダイアログ外のクリック", () => {
    it("ダイアログを閉じ、onConfirmを呼び出さない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const handleConfirm = vi.fn();
      const user = userEvent.setup();
      renderBlocking({
        onOpenChange: handleOpenChange,
        onConfirm: handleConfirm,
      });

      // When
      await user.click(backdrop());

      // Then
      expect(openStates(handleOpenChange)).toEqual([false]);
      expect(handleConfirm).not.toHaveBeenCalled();
    });

    it("完了を待つ間は、ダイアログを閉じない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const user = userEvent.setup();
      renderBlocking({ busy: true, onOpenChange: handleOpenChange });

      // When
      await user.click(backdrop());

      // Then
      expect(handleOpenChange).not.toHaveBeenCalled();
    });
  });

  describe("Escキー", () => {
    it("ダイアログを閉じる", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const user = userEvent.setup();
      renderBlocking({ onOpenChange: handleOpenChange });

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(openStates(handleOpenChange)).toEqual([false]);
    });

    it("完了を待つ間は、ダイアログを閉じない", async () => {
      // Given
      const handleOpenChange = vi.fn();
      const user = userEvent.setup();
      renderBlocking({ busy: true, onOpenChange: handleOpenChange });

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(handleOpenChange).not.toHaveBeenCalled();
    });
  });
});

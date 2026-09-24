import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockingConfirmDialog, ConfirmDialog } from "./confirm-dialog";

// Dialog・DialogContent（dialog.test.tsxで検証済み）は、このテストを削除してもテスト対象以外のカバレッジに影響しないように、別モジュールとの境界としてモックする。
// Dialogはopenの間だけ子要素を描画し、背景クリック・Esc等による開閉の通知を模せるよう、渡されたonOpenChangeを公開するスタブで模す。
// DialogContentは子要素を描画し、nestedをdata属性として公開するスタブで模す。
const dialog = vi.hoisted(() => ({
  onOpenChange: undefined as ((open: boolean) => void) | undefined,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: function DialogStub(props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    dialog.onOpenChange = props.onOpenChange;
    return props.open ? props.children : null;
  },
  DialogContent: function DialogContentStub(props: {
    nested?: boolean;
    children: React.ReactNode;
  }) {
    return (
      <div data-testid="dialog-content" data-nested={String(props.nested)}>
        {props.children}
      </div>
    );
  },
}));

// Button（button.test.tsxで検証済み）は、variant・sizeを除いた属性をbuttonへそのまま渡すスタブで模す。
vi.mock("@/components/ui/button", () => ({
  Button: function ButtonStub({
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<"button"> & { variant?: string; size?: string }) {
    return <button {...props} />;
  },
}));

// cn（utils.test.tsで検証済み）は、渡されたクラスのうち真値のものを空白区切りで連結するスタブで模す。
vi.mock("@/lib/utils", () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(" "),
}));

function cancelButton() {
  return screen.getByTestId("confirm-dialog-cancel");
}

function confirmButton() {
  return screen.getByTestId("confirm-dialog-confirm");
}

// onConfirmの完了を任意のタイミングで制御するためのPromise。
function deferred() {
  let resolve: (value: { error: string } | undefined) => void = () => {};
  const promise = new Promise<{ error: string } | undefined>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  dialog.onOpenChange = undefined;
});

describe("ConfirmDialog", () => {
  describe("表示", () => {
    it("openがtrueの場合、説明文とキャンセル・確認ボタンを表示する", () => {
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
      expect(screen.getByText("この距離を削除しますか？")).toBeInTheDocument();
      expect(cancelButton()).toHaveTextContent("キャンセル");
      expect(confirmButton()).toHaveTextContent("削除");
    });

    it("openがfalseの場合、何も表示しない", () => {
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
      expect(
        screen.queryByText("この距離を削除しますか？"),
      ).not.toBeInTheDocument();
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
        expect(confirmButton()).toHaveTextContent("破棄");
      });
    });

    describe("nested", () => {
      it("trueの場合、DialogContentへtrueを渡す", () => {
        // Given
        const nested = true;

        // When
        render(
          <ConfirmDialog
            open
            onOpenChange={vi.fn()}
            description="説明"
            onConfirm={vi.fn()}
            nested={nested}
          />,
        );

        // Then
        expect(screen.getByTestId("dialog-content")).toHaveAttribute(
          "data-nested",
          "true",
        );
      });

      it("未指定の場合、DialogContentへfalseを渡す", () => {
        // Given
        const description = "説明";

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
        expect(screen.getByTestId("dialog-content")).toHaveAttribute(
          "data-nested",
          "false",
        );
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

  describe("Dialogからの開閉の通知", () => {
    it("onOpenChangeへそのまま伝える", () => {
      // Given
      const handleOpenChange = vi.fn();
      render(
        <ConfirmDialog
          open
          onOpenChange={handleOpenChange}
          description="説明"
          onConfirm={vi.fn()}
        />,
      );

      // When
      act(() => dialog.onOpenChange?.(false));

      // Then
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    });
  });
});

describe("BlockingConfirmDialog", () => {
  describe("表示", () => {
    it("openがtrueの場合、説明文とキャンセル・確認ボタンを表示する", () => {
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
      expect(
        screen.getByText("このラウンドを削除しますか？"),
      ).toBeInTheDocument();
      expect(cancelButton()).toHaveTextContent("キャンセル");
      expect(confirmButton()).toHaveTextContent("削除");
      expect(cancelButton()).toHaveAttribute("aria-disabled", "false");
      expect(confirmButton()).toHaveAttribute("aria-disabled", "false");
    });

    it("openがfalseの場合、何も表示しない", () => {
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
      expect(
        screen.queryByText("このラウンドを削除しますか？"),
      ).not.toBeInTheDocument();
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
        expect(confirmButton()).toHaveTextContent("破棄");
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
      for (const button of [cancelButton(), confirmButton()]) {
        expect(button).toHaveAttribute("aria-disabled", "true");
        expect(button).toHaveClass("pointer-events-none", "opacity-50");
      }
      expect(confirmButton().querySelector("svg")).toHaveClass("animate-spin");
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
      expect(screen.getByText("削除に失敗しました")).toBeInTheDocument();
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

  // 背景クリック・Esc等によるDialogからの開閉の通知。
  describe("Dialogからの開閉の通知", () => {
    it("閉じる通知の場合、onOpenChangeへ伝え、表示中のエラーを消す", async () => {
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
      act(() => dialog.onOpenChange?.(false));

      // Then
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      expect(screen.queryByText("削除に失敗しました")).not.toBeInTheDocument();
    });

    it("開く通知の場合、onOpenChangeへ伝え、表示中のエラーは残す", async () => {
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
      act(() => dialog.onOpenChange?.(true));

      // Then
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(true);
      expect(screen.getByText("削除に失敗しました")).toBeInTheDocument();
    });

    it("完了を待つ間は、閉じる通知をonOpenChangeへ伝えない", () => {
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
      act(() => dialog.onOpenChange?.(false));

      // Then
      expect(handleOpenChange).not.toHaveBeenCalled();
    });

    it("完了を待つ間も、開く通知はonOpenChangeへ伝える", () => {
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
      act(() => dialog.onOpenChange?.(true));

      // Then
      expect(handleOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    });
  });
});

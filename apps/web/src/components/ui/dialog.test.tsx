import { render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

// backdropはroleやテキストを持たないため、DialogContentが付与するクラスで特定する。
function backdrops() {
  return document.querySelectorAll(".bg-black\\/40");
}

describe("DialogContent", () => {
  describe("表示", () => {
    it("子要素をダイアログ内に表示する", () => {
      // Given
      const content = "本文";

      // When
      render(
        <Dialog open>
          <DialogContent>{content}</DialogContent>
        </Dialog>,
      );

      // Then
      expect(screen.getByRole("dialog")).toHaveTextContent("本文");
    });

    it("指定した属性をダイアログへ渡す", () => {
      // Given
      const label = "確認";

      // When
      render(
        <Dialog open>
          <DialogContent aria-label={label}>本文</DialogContent>
        </Dialog>,
      );

      // Then
      expect(screen.getByRole("dialog", { name: "確認" })).toBeInTheDocument();
    });

    describe("className", () => {
      it("指定したクラスを付与する", () => {
        // Given
        const className = "custom-class";

        // When
        render(
          <Dialog open>
            <DialogContent className={className}>本文</DialogContent>
          </Dialog>,
        );

        // Then
        expect(screen.getByRole("dialog")).toHaveClass("custom-class");
      });
    });

    // Base UIは、他のDialog内から開かれたDialogのbackdropを既定では描画しない。
    describe("nested", () => {
      it("trueの場合、ネストしたダイアログでもbackdropを描画する", () => {
        // Given
        const nested = true;

        // When
        render(
          <Dialog open>
            <DialogContent>
              外側
              <Dialog open>
                <DialogContent nested={nested}>内側</DialogContent>
              </Dialog>
            </DialogContent>
          </Dialog>,
        );

        // Then
        expect(backdrops()).toHaveLength(2);
      });

      it.each([
        { label: "false", nested: false },
        { label: "未指定", nested: undefined },
      ])(
        "$labelの場合、ネストしたダイアログではbackdropを描画しない",
        ({ nested }) => {
          // Given
          const inner = <DialogContent nested={nested}>内側</DialogContent>;

          // When
          render(
            <Dialog open>
              <DialogContent>
                外側
                <Dialog open>{inner}</Dialog>
              </DialogContent>
            </Dialog>,
          );

          // Then
          expect(backdrops()).toHaveLength(1);
        },
      );
    });
  });
});

describe("DialogContent 初期フォーカス", () => {
  it("先頭が入力欄でも、入力欄でなくポップアップへフォーカスする", async () => {
    // Given

    // When
    render(
      <Dialog open>
        <DialogContent>
          <input aria-label="名前" />
        </DialogContent>
      </Dialog>,
    );

    // Then
    const dialog = screen.getByRole("dialog");
    // Base UIはフォーカスを開いた後の描画で移す。
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(screen.getByLabelText("名前")).not.toHaveFocus();
  });

  it("initialFocusを指定した場合、指定先へフォーカスする", async () => {
    // Given
    const target = createRef<HTMLButtonElement>();

    // When
    render(
      <Dialog open>
        <DialogContent initialFocus={target}>
          <input aria-label="名前" />
          <button type="button" ref={target}>
            閉じる
          </button>
        </DialogContent>
      </Dialog>,
    );

    // Then
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "閉じる" })).toHaveFocus(),
    );
  });

  it("focusTargetを指定した場合、ポップアップでなく指定先へフォーカスする", async () => {
    // Given
    const target = createRef<HTMLButtonElement>();

    // When
    render(
      <Dialog open>
        <DialogContent focusTarget={target}>
          <input aria-label="名前" />
          <button type="button" ref={target}>
            閉じる
          </button>
        </DialogContent>
      </Dialog>,
    );

    // Then
    expect(screen.getByRole("button", { name: "閉じる" })).toHaveFocus();
    expect(screen.getByLabelText("名前")).not.toHaveFocus();
  });

  it("開いた直後に、遅れて奪われず、同期でポップアップがフォーカスを持つ", () => {
    // Given

    // When
    render(
      <Dialog open>
        <DialogContent>
          <input aria-label="名前" />
        </DialogContent>
      </Dialog>,
    );

    // Then
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("呼び出し側がrefを渡しても、ポップアップへのフォーカスが外れない", async () => {
    // Given
    const ref = createRef<HTMLDivElement>();

    // When
    render(
      <Dialog open>
        <DialogContent ref={ref}>
          <input aria-label="名前" />
        </DialogContent>
      </Dialog>,
    );

    // Then
    expect(ref.current).toBe(screen.getByRole("dialog"));
    await waitFor(() => expect(document.activeElement).toBe(ref.current));
  });
});

describe("DialogTitle", () => {
  it("ダイアログの名前になる", () => {
    // Given

    // When
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>フィルター</DialogTitle>
          本文
        </DialogContent>
      </Dialog>,
    );

    // Then
    expect(
      screen.getByRole("dialog", { name: "フィルター" }),
    ).toBeInTheDocument();
  });
});

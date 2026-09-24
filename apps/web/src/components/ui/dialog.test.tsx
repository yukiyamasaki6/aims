import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent } from "./dialog";

// backdropはroleやテキストを持たないため、DialogContentが付与するクラスで特定する。
function backdrops() {
  return document.querySelectorAll(".bg-black\\/40");
}

describe("DialogContent", () => {
  describe("表示", () => {
    it("子要素をdata-slotを付与したダイアログ内に表示する", () => {
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
      expect(screen.getByRole("dialog")).toHaveAttribute(
        "data-slot",
        "dialog-content",
      );
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
      it("既定のクラスに加えて、指定したクラスを付与する", () => {
        // Given
        const className = "custom-class";

        // When
        render(
          <Dialog open>
            <DialogContent className={className}>本文</DialogContent>
          </Dialog>,
        );

        // Then
        expect(screen.getByRole("dialog")).toHaveClass(
          "bg-card",
          "custom-class",
        );
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

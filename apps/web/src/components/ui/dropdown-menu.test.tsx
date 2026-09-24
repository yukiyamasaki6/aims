import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

// cn（utils.test.tsで検証済み）は、このテストを削除してもテスト対象以外のカバレッジに影響しないように、別モジュールとの境界としてモックする。
// Tailwindのクラス競合の解決は行わず、渡されたクラスを空白区切りで連結するスタブで模す。
vi.mock("@/lib/utils", () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(" "),
}));

// align・sideOffsetはBase UIのPositionerへ渡され、Positionerはalignをdata-alignに、sideOffsetを位置のずれ（transform）に反映する。
function positioner() {
  return screen.getByRole("menu").parentElement;
}

describe("DropdownMenuContent", () => {
  describe("表示", () => {
    it("子要素をdata-slotを付与したメニュー内に表示する", async () => {
      // Given
      const content = "項目";

      // When
      render(
        <DropdownMenu open>
          <DropdownMenuTrigger>開く</DropdownMenuTrigger>
          <DropdownMenuContent>{content}</DropdownMenuContent>
        </DropdownMenu>,
      );

      // Then
      const menu = await screen.findByRole("menu");
      expect(menu).toHaveTextContent("項目");
      expect(menu).toHaveAttribute("data-slot", "dropdown-menu-content");
    });

    describe("className", () => {
      it("既定のクラスに加えて、指定したクラスを付与する", async () => {
        // Given
        const className = "custom-class";

        // When
        render(
          <DropdownMenu open>
            <DropdownMenuTrigger>開く</DropdownMenuTrigger>
            <DropdownMenuContent className={className}>
              項目
            </DropdownMenuContent>
          </DropdownMenu>,
        );

        // Then
        expect(await screen.findByRole("menu")).toHaveClass(
          "bg-card",
          "custom-class",
        );
      });
    });

    describe("align・sideOffset", () => {
      it("未指定の場合、末尾揃え・4pxの間隔で配置する", async () => {
        // Given
        const content = "項目";

        // When
        render(
          <DropdownMenu open>
            <DropdownMenuTrigger>開く</DropdownMenuTrigger>
            <DropdownMenuContent>{content}</DropdownMenuContent>
          </DropdownMenu>,
        );

        // Then
        await waitFor(() => {
          expect(positioner()).toHaveAttribute("data-align", "end");
          expect(positioner()).toHaveStyle({
            transform: "translate(0px, 4px)",
          });
        });
      });

      it("指定した場合、指定した揃え・間隔で配置する", async () => {
        // Given
        const align = "start";
        const sideOffset = 8;

        // When
        render(
          <DropdownMenu open>
            <DropdownMenuTrigger>開く</DropdownMenuTrigger>
            <DropdownMenuContent align={align} sideOffset={sideOffset}>
              項目
            </DropdownMenuContent>
          </DropdownMenu>,
        );

        // Then
        await waitFor(() => {
          expect(positioner()).toHaveAttribute("data-align", "start");
          expect(positioner()).toHaveStyle({
            transform: "translate(0px, 8px)",
          });
        });
      });
    });
  });
});

describe("DropdownMenuItem", () => {
  describe("表示", () => {
    it("子要素をdata-slotを付与したメニュー項目として表示する", async () => {
      // Given
      const label = "削除";

      // When
      render(
        <DropdownMenu open>
          <DropdownMenuTrigger>開く</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>{label}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );

      // Then
      expect(
        await screen.findByRole("menuitem", { name: "削除" }),
      ).toHaveAttribute("data-slot", "dropdown-menu-item");
    });

    describe("className", () => {
      it("既定のクラスに加えて、指定したクラスを付与する", async () => {
        // Given
        const className = "custom-class";

        // When
        render(
          <DropdownMenu open>
            <DropdownMenuTrigger>開く</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem className={className}>削除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>,
        );

        // Then
        expect(
          await screen.findByRole("menuitem", { name: "削除" }),
        ).toHaveClass("cursor-pointer", "custom-class");
      });
    });
  });

  describe("クリック", () => {
    it("onClickを呼び出す", async () => {
      // Given
      const handleClick = vi.fn();
      const user = userEvent.setup();
      render(
        <DropdownMenu open>
          <DropdownMenuTrigger>開く</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={handleClick}>削除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      );

      // When
      await user.click(await screen.findByRole("menuitem", { name: "削除" }));

      // Then
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });
});

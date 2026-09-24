import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

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

    describe("align", () => {
      it("未指定の場合、末尾揃えで配置する", async () => {
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
        expect(await screen.findByRole("menu")).toHaveAttribute(
          "data-align",
          "end",
        );
      });

      it("指定した場合、指定した揃えで配置する", async () => {
        // Given
        const align = "start";

        // When
        render(
          <DropdownMenu open>
            <DropdownMenuTrigger>開く</DropdownMenuTrigger>
            <DropdownMenuContent align={align}>項目</DropdownMenuContent>
          </DropdownMenu>,
        );

        // Then
        expect(await screen.findByRole("menu")).toHaveAttribute(
          "data-align",
          "start",
        );
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

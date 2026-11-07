import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

const roundsText = translatorFor("rounds");

describe("DropdownMenuContent", () => {
  describe("表示", () => {
    it("子要素をメニュー内に表示する", async () => {
      // Given
      const content = "項目";

      // When
      render(
        <DropdownMenu open>
          <DropdownMenuTrigger>開く</DropdownMenuTrigger>
          <DropdownMenuContent>{content}</DropdownMenuContent>
        </DropdownMenu>,
        { wrapper: IntlTestProvider },
      );

      // Then
      const menu = await screen.findByRole("menu");
      expect(menu).toHaveTextContent("項目");
    });

    describe("align", () => {
      it("末尾揃えで配置する", async () => {
        // Given
        const content = "項目";

        // When
        render(
          <DropdownMenu open>
            <DropdownMenuTrigger>開く</DropdownMenuTrigger>
            <DropdownMenuContent>{content}</DropdownMenuContent>
          </DropdownMenu>,
          { wrapper: IntlTestProvider },
        );

        // Then
        expect(await screen.findByRole("menu")).toHaveAttribute(
          "data-align",
          "end",
        );
      });
    });
  });
});

describe("DropdownMenuItem", () => {
  describe("表示", () => {
    it("子要素をメニュー項目として表示する", async () => {
      // Given
      const label = roundsText("delete");

      // When
      render(
        <DropdownMenu open>
          <DropdownMenuTrigger>開く</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>{label}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
        { wrapper: IntlTestProvider },
      );

      // Then
      expect(
        await screen.findByRole("menuitem", { name: roundsText("delete") }),
      ).toBeInTheDocument();
    });

    describe("className", () => {
      it("指定したクラスを付与する", async () => {
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
          { wrapper: IntlTestProvider },
        );

        // Then
        expect(
          await screen.findByRole("menuitem", { name: roundsText("delete") }),
        ).toHaveClass("custom-class");
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
        { wrapper: IntlTestProvider },
      );

      // When
      await user.click(
        await screen.findByRole("menuitem", { name: roundsText("delete") }),
      );

      // Then
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });
});

describe("DropdownMenu", () => {
  describe("外側のクリック", () => {
    it("開いたメニューの外側を押すと、メニューを閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(
        <DropdownMenu>
          <DropdownMenuTrigger>開く</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>項目</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
        { wrapper: IntlTestProvider },
      );
      await user.click(screen.getByText("開く"));
      expect(await screen.findByRole("menu")).toBeInTheDocument();

      // When
      await user.click(document.body);

      // Then
      await waitFor(() => {
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      });
    });
  });
});

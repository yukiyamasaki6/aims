import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { LeftPanel } from "./left-panel";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");

const nav = vi.hoisted(() => ({ pathname: "/rounds" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

beforeEach(() => {
  nav.pathname = "/rounds";
});

function toggleButton(kind: "Collapse" | "Expand") {
  return screen.getByRole("button", {
    name: navigationText(`leftPanel${kind}`),
  });
}

function openMenuButton() {
  return screen.getByRole("button", {
    name: navigationText("leftPanelOpenMenu"),
  });
}

function closeMenuButtons() {
  return screen.getAllByRole("button", {
    name: navigationText("leftPanelCloseMenu"),
  });
}

function drawerPanel() {
  const panel = closeMenuButtons()[1]?.closest("aside");
  if (!panel) throw new Error("ドロワーのパネルが見つかりません");
  return panel;
}

function drawerBackdrop() {
  return closeMenuButtons()[0];
}

function drag(element: Element, fromX: number, toX: number) {
  fireEvent.touchStart(element, {
    touches: [{ clientX: fromX, clientY: 100 }],
  });
  fireEvent.touchMove(element, {
    touches: [{ clientX: toX, clientY: 100 }],
  });
}

describe("LeftPanel", () => {
  describe("狭い画面のメニュー", () => {
    // 閉じるボタン（X）と背景は常時DOM上にある。背景は閉じている間aria-hiddenなので、役割で見える閉じるボタンの件数で開閉を判定する。
    it("パネル内の閉じるボタンを押すと閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, {
        wrapper: IntlTestProvider,
      });
      await user.click(openMenuButton());
      const backdrop = drawerBackdrop();

      // When
      await user.click(closeMenuButtons()[1]);

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
      expect(backdrop).toHaveStyle({ opacity: "0" });
    });

    it.each(["パネル内", "背景"] as const)(
      "%sで左へドラッグするとパネルと背景が追従し、離すと閉じる",
      async (origin) => {
        // Given
        const user = userEvent.setup();
        render(<LeftPanel />, { wrapper: IntlTestProvider });
        await user.click(openMenuButton());
        const panel = drawerPanel();
        const backdrop = drawerBackdrop();
        const target = origin === "パネル内" ? panel : backdrop;

        // When
        drag(target, 180, 80);

        // Then
        expect(panel).toHaveStyle({ transform: "translateX(-100px)" });
        expect(backdrop).toHaveStyle({ opacity: "0.609375" });

        // When
        fireEvent.touchEnd(target, {
          changedTouches: [{ clientX: 80, clientY: 100 }],
        });

        // Then
        expect(closeMenuButtons()).toHaveLength(1);
        expect(backdrop).toHaveStyle({ opacity: "0" });
      },
    );

    it("短いドラッグではパネルと背景が元に戻る", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, { wrapper: IntlTestProvider });
      await user.click(openMenuButton());
      const panel = drawerPanel();
      const backdrop = drawerBackdrop();

      // When
      drag(panel, 180, 150);

      // Then
      expect(panel).toHaveStyle({ transform: "translateX(-30px)" });
      expect(backdrop).toHaveStyle({ opacity: "0.8828125" });

      // When
      fireEvent.touchEnd(panel, {
        changedTouches: [{ clientX: 150, clientY: 100 }],
      });

      // Then
      expect(closeMenuButtons()).toHaveLength(2);
      expect(panel).toHaveStyle({ transform: "translateX(0px)" });
      expect(backdrop).toHaveStyle({ opacity: "1" });
    });
  });

  // jsdomはCSSを評価しないため、表示の切替（幅と向き）はE2Eで確かめる。ここでは、ドロワーと列が別々に持つ開閉の状態を確かめる。
  describe("開閉の状態", () => {
    it("操作前は、列のボタンが格納するで、ドロワーの背景は出ない", () => {
      // Given
      // When
      render(<LeftPanel />, {
        wrapper: IntlTestProvider,
      });

      // Then
      expect(toggleButton("Collapse")).toBeInTheDocument();
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("列のボタンで格納すると、ボタンが開くになり、ドロワーは開かない", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, {
        wrapper: IntlTestProvider,
      });

      // When
      await user.click(toggleButton("Collapse"));

      // Then
      expect(toggleButton("Expand")).toBeInTheDocument();
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("列のボタンで格納した後に展開すると、ボタンが格納するになり、ドロワーは開かない", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, {
        wrapper: IntlTestProvider,
      });
      await user.click(toggleButton("Collapse"));

      // When
      await user.click(toggleButton("Expand"));

      // Then
      expect(toggleButton("Collapse")).toBeInTheDocument();
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("ハンバーガーで開いた後に背景を押すと、ドロワーが閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, {
        wrapper: IntlTestProvider,
      });
      await user.click(openMenuButton());
      const backdrop = drawerBackdrop();

      // When
      // 背景はパネルより前にDOMへ配置される。
      await user.click(backdrop);

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
      expect(backdrop).toHaveStyle({ opacity: "0" });
    });

    it("ハンバーガーでドロワーを開くと、背景が出て、列のボタンは操作前のままである", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, {
        wrapper: IntlTestProvider,
      });

      // When
      await user.click(openMenuButton());

      // Then
      expect(closeMenuButtons()).toHaveLength(2);
      expect(toggleButton("Collapse")).toBeInTheDocument();
    });
  });

  describe("ホーム・履歴の項目", () => {
    // 項目は2つの枠に1つずつあり、DOM順で先のドロワーの枠を押す。
    function homeLink() {
      return screen.getAllByRole("link", {
        name: navigationText("leftPanelHome"),
      })[0];
    }

    function historyLink() {
      return screen.getAllByRole("link", {
        name: navigationText("leftPanelHistory"),
      })[0];
    }

    function settingsLink() {
      return screen.getAllByRole("link", {
        name: navigationText("leftPanelSettings"),
      })[0];
    }

    it("ホーム・履歴・設定の項目を2つの枠に表示し、個人の項目は表示しない", () => {
      // Given
      // When
      render(<LeftPanel />, { wrapper: IntlTestProvider });

      // Then
      expect(
        screen.getAllByRole("link", { name: navigationText("leftPanelHome") }),
      ).toHaveLength(2);
      expect(
        screen.getAllByRole("link", {
          name: navigationText("leftPanelHistory"),
        }),
      ).toHaveLength(2);
      expect(
        screen.getAllByRole("link", {
          name: navigationText("leftPanelSettings"),
        }),
      ).toHaveLength(2);
      expect(screen.queryByText("個人")).toBeNull();
    });

    it("設定の項目は、各枠でホーム・履歴より後に置かれる", () => {
      // Given
      // When
      render(<LeftPanel />, { wrapper: IntlTestProvider });

      // Then
      const names = [
        navigationText("leftPanelHome"),
        navigationText("leftPanelHistory"),
        navigationText("leftPanelSettings"),
      ];
      const order = screen
        .getAllByRole("link")
        .map((link) => link.textContent)
        .filter((text) => names.includes(text ?? ""));
      expect(order).toEqual([...names, ...names]);
    });

    it("サインアウトのボタンは表示しない", () => {
      // Given
      // When
      render(<LeftPanel />, { wrapper: IntlTestProvider });

      // Then
      expect(
        screen.queryByRole("button", { name: authText("signOut") }),
      ).toBeNull();
    });

    it.each([
      ["/rounds", "leftPanelHome"],
      ["/rounds/history", "leftPanelHistory"],
      ["/settings", "leftPanelSettings"],
    ] as const)(
      "パスが%sのとき、%sの項目だけが現在のページになる",
      (pathname, current) => {
        // Given
        nav.pathname = pathname;

        // When
        render(<LeftPanel />, { wrapper: IntlTestProvider });

        // Then
        const currentLinks = screen.getAllByRole("link", { current: "page" });
        expect(currentLinks.map((link) => link.textContent)).toEqual([
          navigationText(current),
          navigationText(current),
        ]);
      },
    );

    it.each(["/rounds/new", "/rounds/123e4567-e89b-12d3-a456-426614174000"])(
      "パスが%s(詳細・作成)のとき、どの項目も現在のページにならない",
      (pathname) => {
        // Given
        nav.pathname = pathname;

        // When
        render(<LeftPanel />, { wrapper: IntlTestProvider });

        // Then
        expect(screen.queryByRole("link", { current: "page" })).toBeNull();
      },
    );

    it("ハンバーガーでドロワーを開き、ホームの項目を押すと、ドロワーが閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, { wrapper: IntlTestProvider });
      await user.click(openMenuButton());

      // When
      await user.click(homeLink());

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("ハンバーガーでドロワーを開き、設定の項目を押すと、ドロワーが閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, { wrapper: IntlTestProvider });
      await user.click(openMenuButton());

      // When
      await user.click(settingsLink());

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("列のボタンで格納した後に設定の項目を押しても、列のボタンは開くのまま変わらない", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, { wrapper: IntlTestProvider });
      await user.click(toggleButton("Collapse"));

      // When
      await user.click(settingsLink());

      // Then
      expect(toggleButton("Expand")).toBeInTheDocument();
    });

    it("Tabを押し進めると、設定の項目へフォーカスが届く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, { wrapper: IntlTestProvider });

      // When
      for (let i = 0; i < 20 && document.activeElement !== settingsLink(); i++)
        await user.tab();

      // Then
      expect(settingsLink()).toHaveFocus();
    });

    it("列のボタンで格納した後に履歴の項目を押しても、列のボタンは開くのまま変わらない", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel />, { wrapper: IntlTestProvider });
      await user.click(toggleButton("Collapse"));

      // When
      await user.click(historyLink());

      // Then
      expect(toggleButton("Expand")).toBeInTheDocument();
    });
  });
});

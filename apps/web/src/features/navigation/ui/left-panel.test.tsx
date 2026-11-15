import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenFrame } from "@/components/screen-frame";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import {
  type FakeViewport,
  installFakeViewport,
} from "@/lib/viewport/fake-viewport-test-helpers";
import { LeftPanel } from "./left-panel";

const authText = translatorFor("auth");
const navigationText = translatorFor("navigation");

const nav = vi.hoisted(() => ({ pathname: "/rounds" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

let viewport: FakeViewport;

// 既定は幅768px未満(ドロワーの閉じ込めが有効になりうる幅)。
beforeEach(() => {
  nav.pathname = "/rounds";
  viewport = installFakeViewport();
});

afterEach(() => {
  viewport.restore();
});

// ドロワーの開き口はScreenFrameが置くため、ヘッダー枠を描く子を持たせる。
function PanelWithFrame() {
  return (
    <LeftPanel>
      <ScreenFrame title="ホーム">
        <p>本文</p>
      </ScreenFrame>
    </LeftPanel>
  );
}

function openMenuButtons() {
  return screen.getAllByRole("button", {
    name: navigationText("leftPanelOpenMenu"),
  });
}

function openMenuButton() {
  return screen.getByRole("button", {
    name: navigationText("leftPanelOpenMenu"),
  });
}

// jsdomはCSSを当てないため、背景、ドロワーの閉じるボタン、列の閉じるボタンがDOM順に並ぶ。背景は常にaria-hiddenで、役割の名前では取れないためaria-labelで取る。
function closeMenuButtons() {
  return screen.getAllByLabelText(navigationText("leftPanelCloseMenu"));
}

function drawerBackdrop() {
  return closeMenuButtons()[0];
}

function drawerCloseButton() {
  return closeMenuButtons()[1];
}

function railCloseButton() {
  return closeMenuButtons()[2];
}

function drawerPanel() {
  const panel = drawerCloseButton().closest("aside");
  if (!panel) throw new Error("ドロワーのパネルが見つかりません");
  return panel;
}

function railPanel() {
  const panel = railCloseButton().closest("aside");
  if (!panel) throw new Error("列のパネルが見つかりません");
  return panel;
}

function drawerLink(
  name: "leftPanelHome" | "leftPanelHistory" | "leftPanelSettings",
) {
  return within(drawerPanel()).getByRole("link", {
    name: navigationText(name),
  });
}

// 本文領域のinert。jsdomはinertでフォーカスを止めないため、属性の有無で確かめる。
function isBodyInert() {
  return document.querySelector("[inert]") !== null;
}

async function openDrawer(user: User) {
  await user.click(openMenuButton());
}

// 列用の「メニューを開く」は、列を閉じる前後の開くボタンの差分で得る。
async function closeRail(user: User) {
  const before = openMenuButtons();
  await user.click(railCloseButton());
  const added = openMenuButtons().filter((button) => !before.includes(button));
  if (added.length !== 1)
    throw new Error("列用のメニューを開くボタンが1つ増えていません");
  return added[0];
}

type User = ReturnType<typeof userEvent.setup>;

function drag(element: Element, fromX: number, toX: number) {
  fireEvent.touchStart(element, {
    touches: [{ clientX: fromX, clientY: 100 }],
  });
  fireEvent.touchMove(element, {
    touches: [{ clientX: toX, clientY: 100 }],
  });
}

describe("LeftPanel", () => {
  describe("ドロワーのフォーカス", () => {
    it("メニューボタンで開くと、フォーカスがドロワー内の最初のボタン(閉じる)へ移る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // When
      await user.click(openMenuButton());

      // Then
      expect(drawerCloseButton()).toHaveFocus();
      expect(drawerPanel()).toContainElement(
        document.activeElement as HTMLElement,
      );
    });

    it("閉じるボタンで閉じると、フォーカスがメニューボタンへ戻る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await user.click(openMenuButton());

      // When
      await user.click(drawerCloseButton());

      // Then
      expect(openMenuButton()).toHaveFocus();
    });

    it("ドロワーの項目を押して閉じると、フォーカスがメニューボタンへ戻る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await user.click(openMenuButton());

      // When
      await user.click(
        screen.getAllByRole("link", {
          name: navigationText("leftPanelHome"),
        })[0],
      );

      // Then
      expect(openMenuButton()).toHaveFocus();
    });

    it("閉じるとき、フォーカスがドロワーの外の別の要素にあれば、メニューボタンへ奪わない", async () => {
      // Given
      const user = userEvent.setup();
      render(
        <>
          <input aria-label="外の入力" />
          <PanelWithFrame />
        </>,
        { wrapper: IntlTestProvider },
      );
      await user.click(openMenuButton());
      const outside = screen.getByLabelText("外の入力");
      outside.focus();

      // When
      await user.click(drawerBackdrop());

      // Then
      expect(drawerBackdrop()).toHaveStyle({ opacity: "0" });
      expect(openMenuButton()).not.toHaveFocus();
    });

    it("開いていない間は、フォーカスをメニューボタンへ移さない", () => {
      // Given
      // When
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // Then
      expect(openMenuButton()).not.toHaveFocus();
      expect(document.body).toHaveFocus();
    });
  });

  describe("ヘッダーのメニューボタン", () => {
    it("子がScreenFrameを描くと、メニューを開くボタンが1つ出て、押すとドロワーが展開される", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      expect(drawerBackdrop()).toHaveStyle({ opacity: "0" });

      // When
      await user.click(openMenuButton());

      // Then
      expect(openMenuButtons()).toHaveLength(1);
      expect(drawerBackdrop()).toHaveStyle({ opacity: "1" });
    });

    it("子がScreenFrameを持たないと、メニューを開くボタンは出ない", () => {
      // Given
      // When
      render(
        <LeftPanel>
          <p>本文</p>
        </LeftPanel>,
        { wrapper: IntlTestProvider },
      );

      // Then
      expect(
        screen.queryByRole("button", {
          name: navigationText("leftPanelOpenMenu"),
        }),
      ).toBeNull();
    });
  });

  describe("狭い画面のメニュー", () => {
    // 閉じるボタン(X)と背景は常時DOM上にあり、背景は常にaria-hiddenなので、開閉は背景のopacityで判定する。
    it("パネル内の閉じるボタンを押すと閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, {
        wrapper: IntlTestProvider,
      });
      await user.click(openMenuButton());
      const backdrop = drawerBackdrop();

      // When
      await user.click(drawerCloseButton());

      // Then
      expect(backdrop).toHaveStyle({ opacity: "0" });
    });

    it.each(["パネル内", "背景"] as const)(
      "%sで左へドラッグするとパネルと背景が追従し、離すと閉じる",
      async (origin) => {
        // Given
        const user = userEvent.setup();
        render(<PanelWithFrame />, { wrapper: IntlTestProvider });
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
        expect(backdrop).toHaveStyle({ opacity: "0" });
      },
    );

    it("短いドラッグではパネルと背景が元に戻る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
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
      expect(panel).toHaveStyle({ transform: "translateX(0px)" });
      expect(backdrop).toHaveStyle({ opacity: "1" });
    });
  });

  describe("ドロワーの背景", () => {
    it("開いた後に背景を押すと、ドロワーが閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);
      const backdrop = drawerBackdrop();

      // When
      await user.click(backdrop);

      // Then
      expect(backdrop).toHaveStyle({ opacity: "0" });
    });

    it("背景はフォーカス順に入らない", () => {
      // Given
      // When
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // Then
      expect(drawerBackdrop()).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("ドロワーの閉じ込め(幅768px未満)", () => {
    const closers: [string, (user: User) => Promise<unknown>][] = [
      ["閉じるボタン", async (user) => user.click(drawerCloseButton())],
      ["背景", async (user) => user.click(drawerBackdrop())],
      ["ホームの項目", async (user) => user.click(drawerLink("leftPanelHome"))],
      [
        "設定の項目",
        async (user) => user.click(drawerLink("leftPanelSettings")),
      ],
      [
        "左へのスワイプ",
        async () => {
          const panel = drawerPanel();
          drag(panel, 180, 80);
          fireEvent.touchEnd(panel, {
            changedTouches: [{ clientX: 80, clientY: 100 }],
          });
        },
      ],
      ["Esc", async (user) => user.keyboard("{Escape}")],
    ];

    it("開く前は本文領域がinertでなく、開くとinertになる", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      const before = isBodyInert();

      // When
      await openDrawer(user);

      // Then
      expect(before).toBe(false);
      expect(isBodyInert()).toBe(true);
    });

    it.each(closers)(
      "%sで閉じると、本文領域のinertが外れる",
      async (_name, close) => {
        // Given
        const user = userEvent.setup();
        render(<PanelWithFrame />, { wrapper: IntlTestProvider });
        await openDrawer(user);

        // When
        await close(user);

        // Then
        expect(isBodyInert()).toBe(false);
      },
    );

    it("末尾の項目でTabを押すと、先頭の閉じるボタンへ回る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);
      drawerLink("leftPanelSettings").focus();

      // When
      await user.tab();

      // Then
      expect(drawerCloseButton()).toHaveFocus();
    });

    it("先頭の閉じるボタンでShift+Tabを押すと、末尾の設定の項目へ回る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);

      // When
      await user.tab({ shift: true });

      // Then
      expect(drawerLink("leftPanelSettings")).toHaveFocus();
    });

    it("Tabを繰り返すと、閉じる・ロゴ・ホーム・履歴・設定の順に一巡する", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);
      const logo = within(drawerPanel()).getAllByRole("link")[0];
      const visited: (Element | null)[] = [document.activeElement];

      // When
      for (let i = 0; i < 5; i++) {
        await user.tab();
        visited.push(document.activeElement);
      }

      // Then
      expect(visited).toEqual([
        drawerCloseButton(),
        logo,
        drawerLink("leftPanelHome"),
        drawerLink("leftPanelHistory"),
        drawerLink("leftPanelSettings"),
        drawerCloseButton(),
      ]);
    });

    it("フォーカスがドロワーの外にあるとき、Tabでドロワーの先頭へ入る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);
      (document.activeElement as HTMLElement).blur();

      // When
      await user.tab();

      // Then
      expect(drawerCloseButton()).toHaveFocus();
    });

    it("フォーカスがドロワーの外にあるとき、Shift+Tabでドロワーの末尾へ入る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);
      (document.activeElement as HTMLElement).blur();

      // When
      await user.tab({ shift: true });

      // Then
      expect(drawerLink("leftPanelSettings")).toHaveFocus();
    });

    it("Escを押すとドロワーが閉じ、フォーカスがメニューボタンへ戻る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(drawerBackdrop()).toHaveStyle({ opacity: "0" });
      expect(openMenuButton()).toHaveFocus();
    });

    it("閉じている間は、Tabのキー操作を横取りしない", () => {
      // Given
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // When
      const notPrevented = fireEvent.keyDown(document.body, { key: "Tab" });

      // Then
      expect(notPrevented).toBe(true);
    });

    it("開いたまま幅768px以上になると、本文領域のinertが外れ、Escでも閉じない", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);

      // When
      act(() => viewport.setWide(true));
      await user.keyboard("{Escape}");

      // Then
      expect(isBodyInert()).toBe(false);
      expect(drawerBackdrop()).toHaveStyle({ opacity: "1" });
    });

    it("開いたまま幅768px以上になると、末尾の項目のTabでドロワーの先頭へ回らない", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);
      act(() => viewport.setWide(true));
      drawerLink("leftPanelSettings").focus();

      // When
      await user.tab();

      // Then
      expect(drawerCloseButton()).not.toHaveFocus();
    });

    it("幅768px以上から768px未満へ戻ると、開いたままで閉じ込めが再び働く", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await openDrawer(user);
      act(() => viewport.setWide(true));

      // When
      act(() => viewport.setWide(false));
      drawerLink("leftPanelSettings").focus();
      await user.tab();

      // Then
      expect(drawerBackdrop()).toHaveStyle({ opacity: "1" });
      expect(isBodyInert()).toBe(true);
      expect(drawerCloseButton()).toHaveFocus();
    });
  });

  describe("縦の列(幅768px以上)", () => {
    beforeEach(() => {
      viewport.setWide(true);
    });

    it("初期は列が出ていて、閉じるボタンが1つあり、列用の開くボタンは無い", () => {
      // Given
      // When
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // Then
      expect(
        within(railPanel()).getAllByRole("button", {
          name: navigationText("leftPanelCloseMenu"),
        }),
      ).toHaveLength(1);
      expect(openMenuButtons()).toHaveLength(1);
    });

    it("閉じるボタンで閉じると、列用の開くボタンが増え、ドロワーは開かない", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // When
      await user.click(railCloseButton());

      // Then
      expect(openMenuButtons()).toHaveLength(2);
      expect(drawerBackdrop()).toHaveStyle({ opacity: "0" });
    });

    it("閉じた後に列用の開くボタンを押すと、列用の開くボタンが消え、列の閉じるボタンが残る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      const railMenu = await closeRail(user);

      // When
      await user.click(railMenu);

      // Then
      expect(openMenuButtons()).toHaveLength(1);
      expect(railCloseButton()).toBeInTheDocument();
      expect(drawerBackdrop()).toHaveStyle({ opacity: "0" });
    });

    it("閉じると、フォーカスが列用の開くボタンへ移る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // When
      const railMenu = await closeRail(user);

      // Then
      expect(railMenu).toHaveFocus();
    });

    it("開くと、フォーカスが列の閉じるボタンへ移る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      const railMenu = await closeRail(user);

      // When
      await user.click(railMenu);

      // Then
      expect(railCloseButton()).toHaveFocus();
    });

    it("初回の描画ではフォーカスを移さない", () => {
      // Given
      // When
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // Then
      expect(document.body).toHaveFocus();
    });

    it.each([
      ["leftPanelHome"],
      ["leftPanelHistory"],
      ["leftPanelSettings"],
    ] as const)("列の%sの項目を押しても、列は閉じない", async (name) => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // When
      await user.click(
        within(railPanel()).getByRole("link", { name: navigationText(name) }),
      );

      // Then
      expect(railCloseButton()).toBeInTheDocument();
      expect(openMenuButtons()).toHaveLength(1);
    });

    it("列が出ている間は、本文領域がinertでなく、Escで閉じない", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(isBodyInert()).toBe(false);
      expect(openMenuButtons()).toHaveLength(1);
    });

    it("列の末尾の項目でTabを押すと、列の外へフォーカスが移る", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      within(railPanel())
        .getByRole("link", { name: navigationText("leftPanelSettings") })
        .focus();

      // When
      await user.tab();

      // Then
      expect(railPanel()).not.toContainElement(
        document.activeElement as HTMLElement,
      );
      expect(railCloseButton()).not.toHaveFocus();
    });

    it("列内のボタンは閉じるボタンだけで、格納・展開のボタンは無い", () => {
      // Given
      // When
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // Then
      const names = within(railPanel())
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));
      expect(names).toEqual([navigationText("leftPanelCloseMenu")]);
    });

    it("列を閉じた後に幅768px未満から以上へ戻しても、閉じたままである", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await closeRail(user);

      // When
      act(() => viewport.setWide(false));
      act(() => viewport.setWide(true));

      // Then
      expect(openMenuButtons()).toHaveLength(2);
    });

    it("列を閉じた後にドロワーを開いて閉じても、列は閉じたままである", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      const railMenu = await closeRail(user);
      const drawerMenu = openMenuButtons().find(
        (button) => button !== railMenu,
      );

      // When
      await user.click(drawerMenu as HTMLElement);
      await user.click(drawerCloseButton());

      // Then
      expect(drawerBackdrop()).toHaveStyle({ opacity: "0" });
      expect(openMenuButtons()).toHaveLength(2);
    });

    it("列を開いたままドロワーを開いて閉じても、列は開いたままである", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // When
      await user.click(openMenuButton());
      await user.click(drawerCloseButton());

      // Then
      expect(drawerBackdrop()).toHaveStyle({ opacity: "0" });
      expect(openMenuButtons()).toHaveLength(1);
    });
  });

  describe("ホーム・履歴の項目", () => {
    // 項目は2つの枠に1つずつあり、DOM順で先のドロワーの枠を押す。
    function homeLink() {
      return screen.getAllByRole("link", {
        name: navigationText("leftPanelHome"),
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
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

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
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

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
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

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
        render(<PanelWithFrame />, { wrapper: IntlTestProvider });

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
        render(<PanelWithFrame />, { wrapper: IntlTestProvider });

        // Then
        expect(screen.queryByRole("link", { current: "page" })).toBeNull();
      },
    );

    it("ハンバーガーでドロワーを開き、ホームの項目を押すと、ドロワーが閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await user.click(openMenuButton());

      // When
      await user.click(homeLink());

      // Then
      expect(drawerBackdrop()).toHaveStyle({ opacity: "0" });
    });

    it("ハンバーガーでドロワーを開き、設定の項目を押すと、ドロワーが閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });
      await user.click(openMenuButton());

      // When
      await user.click(settingsLink());

      // Then
      expect(drawerBackdrop()).toHaveStyle({ opacity: "0" });
    });

    it("Tabを押し進めると、設定の項目へフォーカスが届く", async () => {
      // Given
      const user = userEvent.setup();
      render(<PanelWithFrame />, { wrapper: IntlTestProvider });

      // When
      for (let i = 0; i < 20 && document.activeElement !== settingsLink(); i++)
        await user.tab();

      // Then
      expect(settingsLink()).toHaveFocus();
    });
  });
});

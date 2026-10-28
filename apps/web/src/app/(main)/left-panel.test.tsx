import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeftPanel } from "./left-panel";

function wideToggle() {
  return screen.getByTestId("left-panel-toggle-wide");
}

function compactToggle() {
  return screen.getByTestId("left-panel-toggle-compact");
}

function panel() {
  return screen.getByRole("complementary");
}

function closeMenuButtons() {
  return screen.getAllByRole("button", { name: "メニューを閉じる" });
}

describe("LeftPanel", () => {
  describe("サインアウトの操作", () => {
    it("入口が渡した操作を、下端の領域に表示する", () => {
      // Given
      const signOut = <button type="button">サインアウト</button>;

      // When
      render(<LeftPanel signOut={signOut} />);

      // Then
      expect(
        screen.getByRole("button", { name: "サインアウト" }),
      ).toBeInTheDocument();
    });
  });

  describe("リンク", () => {
    // 遷移先は、押して確かめるE2E（navigation.spec.ts）に任せる。
    it("AIMSロゴと個人リンクを表示する", () => {
      // Given
      // When
      render(<LeftPanel signOut={null} />);

      // Then
      expect(screen.getByRole("link", { name: "AIMS" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "個人" })).toBeInTheDocument();
    });
  });

  describe("縦向きで狭い画面のメニュー", () => {
    // 閉じるボタン（X）は常時DOM上に存在するため、開いている間だけ表示される背景の閉じるボタンの分だけ件数が増えることで開閉を判定する。
    it("開くボタンを押すと、背景を含めて開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);

      // When
      await user.click(screen.getByRole("button", { name: "メニューを開く" }));

      // Then
      expect(closeMenuButtons()).toHaveLength(2);
    });

    it("背景を押すと閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);
      await user.click(screen.getByRole("button", { name: "メニューを開く" }));

      // When
      // 背景はパネルより前にDOMへ配置される。
      await user.click(closeMenuButtons()[0]);

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("パネル内の閉じるボタンを押すと閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);
      await user.click(screen.getByRole("button", { name: "メニューを開く" }));

      // When
      await user.click(closeMenuButtons()[1]);

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
    });
  });

  describe("広い画面のパネル", () => {
    it("格納ボタンを押すと格納する", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを開く");
    });

    it("格納後に開くボタンを押すと再び開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);
      await user.click(wideToggle());

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
    });
  });

  // jsdomはCSSを評価しないため、表示の切替（向きと幅）はE2Eで確かめる。ここでは共有される開閉の状態と、2つの開閉ボタンの表示を確かめる。
  describe("開閉の状態の共有", () => {
    it("操作前は、広い用が格納する、横向きかつ狭い用が開くで、ドロワーの背景は出ない", () => {
      // Given
      // When
      render(<LeftPanel signOut={null} />);

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
      expect(compactToggle()).toHaveAccessibleName("パネルを開く");
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("広い用で格納すると、両方のボタンが開くになり、ドロワーは開かない", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを開く");
      expect(compactToggle()).toHaveAccessibleName("パネルを開く");
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("広い用で格納した後に展開すると、両方のボタンが格納するになり、ドロワーが開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);
      await user.click(wideToggle());

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
      expect(compactToggle()).toHaveAccessibleName("パネルを格納する");
      expect(closeMenuButtons()).toHaveLength(2);
    });

    it("横向きかつ狭い用で展開すると、広い用も格納するになり、ドロワーが開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);

      // When
      await user.click(compactToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
      expect(closeMenuButtons()).toHaveLength(2);
    });

    it("横向きかつ狭い用で展開した後に背景を押すと、両方のボタンが開くになり、ドロワーが閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);
      await user.click(compactToggle());

      // When
      // 背景はパネルより前にDOMへ配置される。
      await user.click(closeMenuButtons()[0]);

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを開く");
      expect(compactToggle()).toHaveAccessibleName("パネルを開く");
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("ハンバーガーでドロワーを開くと、両方のボタンが格納するになる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />);

      // When
      await user.click(screen.getByRole("button", { name: "メニューを開く" }));

      // Then
      expect(wideToggle()).toHaveAccessibleName("パネルを格納する");
      expect(compactToggle()).toHaveAccessibleName("パネルを格納する");
    });
  });

  describe("開閉のtransition", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("初回表示ではtransitionが付かない", () => {
      // Given
      // When
      render(<LeftPanel signOut={null} />);

      // Then
      expect(panel()).not.toHaveClass("duration-200");
    });

    it("操作の直後はtransitionが付く", async () => {
      // Given
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LeftPanel signOut={null} />);

      // When
      await user.click(wideToggle());

      // Then
      expect(panel()).toHaveClass("duration-200");
    });

    it("操作から250ms経つと、transitionが外れる", async () => {
      // Given
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LeftPanel signOut={null} />);
      await user.click(wideToggle());

      // When
      act(() => {
        vi.advanceTimersByTime(250);
      });

      // Then
      expect(panel()).not.toHaveClass("duration-200");
    });

    it("100ms間隔の2回の操作では、最初の操作から200ms後もまだ付いている", async () => {
      // Given
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LeftPanel signOut={null} />);
      await user.click(wideToggle());
      act(() => {
        vi.advanceTimersByTime(100);
      });
      await user.click(wideToggle());

      // When
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Then
      expect(panel()).toHaveClass("duration-200");
    });
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { LeftPanel } from "./left-panel";

const navigationText = translatorFor("navigation");

function wideToggle() {
  return screen.getByTestId("left-panel-toggle-wide");
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

describe("LeftPanel", () => {
  describe("狭い画面のメニュー", () => {
    // 閉じるボタン（X）は常時DOM上に存在するため、開いている間だけ表示される背景の閉じるボタンの分だけ件数が増えることで開閉を判定する。
    it("パネル内の閉じるボタンを押すと閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />, {
        wrapper: IntlTestProvider,
      });
      await user.click(openMenuButton());

      // When
      await user.click(closeMenuButtons()[1]);

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
    });
  });

  // jsdomはCSSを評価しないため、表示の切替（幅と向き）はE2Eで確かめる。ここでは、ドロワーと列が別々に持つ開閉の状態を確かめる。
  describe("開閉の状態", () => {
    it("操作前は、列のボタンが格納するで、ドロワーの背景は出ない", () => {
      // Given
      // When
      render(<LeftPanel signOut={null} />, {
        wrapper: IntlTestProvider,
      });

      // Then
      expect(wideToggle()).toHaveAccessibleName(
        navigationText("leftPanelCollapse"),
      );
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("列のボタンで格納すると、ボタンが開くになり、ドロワーは開かない", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />, {
        wrapper: IntlTestProvider,
      });

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName(
        navigationText("leftPanelExpand"),
      );
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("列のボタンで格納した後に展開すると、ボタンが格納するになり、ドロワーは開かない", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />, {
        wrapper: IntlTestProvider,
      });
      await user.click(wideToggle());

      // When
      await user.click(wideToggle());

      // Then
      expect(wideToggle()).toHaveAccessibleName(
        navigationText("leftPanelCollapse"),
      );
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("ハンバーガーで開いた後に背景を押すと、ドロワーが閉じる", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />, {
        wrapper: IntlTestProvider,
      });
      await user.click(openMenuButton());

      // When
      // 背景はパネルより前にDOMへ配置される。
      await user.click(closeMenuButtons()[0]);

      // Then
      expect(closeMenuButtons()).toHaveLength(1);
    });

    it("ハンバーガーでドロワーを開くと、背景が出て、列のボタンは操作前のままである", async () => {
      // Given
      const user = userEvent.setup();
      render(<LeftPanel signOut={null} />, {
        wrapper: IntlTestProvider,
      });

      // When
      await user.click(openMenuButton());

      // Then
      expect(closeMenuButtons()).toHaveLength(2);
      expect(wideToggle()).toHaveAccessibleName(
        navigationText("leftPanelCollapse"),
      );
    });
  });
});

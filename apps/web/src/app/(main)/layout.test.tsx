import { Children, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import MainLayout from "./layout";
import { LeftPanel } from "./left-panel";

describe("MainLayout", () => {
  // LeftPanelは非同期のServer Componentで、jsdom上のクライアント描画では実行できないため、返される要素ツリーを検査する（LeftPanel自体の表示はleft-panel.test.tsxで検証する）。
  it("左パネルと子要素を並べて配置する", () => {
    // Given
    const children = <p>子要素</p>;

    // When
    const element = MainLayout({ children });

    // Then
    const [panel, content] = Children.toArray(element.props.children);
    expect(isValidElement(panel) && panel.type).toBe(LeftPanel);
    expect(
      isValidElement<{ children: React.ReactNode }>(content) &&
        content.props.children,
    ).toBe(children);
  });
});

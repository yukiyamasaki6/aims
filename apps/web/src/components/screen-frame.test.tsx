import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenFrame, ScreenMenuProvider } from "./screen-frame";

const menu = <button type="button">メニュー</button>;

describe("ScreenFrame", () => {
  it("titleを渡すと、名前がtitleのレベル1の見出しが1つ出る", () => {
    // Given
    // When
    render(
      <ScreenFrame title="ホーム">
        <p>本文</p>
      </ScreenFrame>,
    );

    // Then
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "ホーム" }),
    ).toBeInTheDocument();
  });

  it("titleが無いと、見出しは出ない", () => {
    // Given
    // When
    render(
      <ScreenFrame>
        <p>本文</p>
      </ScreenFrame>,
    );

    // Then
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("leading・trailing・childrenを描き、leadingとtrailingはヘッダーの中、childrenはヘッダーの外に置く", () => {
    // Given
    // When
    render(
      <ScreenFrame
        title="ホーム"
        leading={<span>先頭</span>}
        trailing={<span>末尾</span>}
      >
        <p>本文</p>
      </ScreenFrame>,
    );

    // Then
    expect(screen.getByText("先頭").closest("header")).not.toBeNull();
    expect(screen.getByText("末尾").closest("header")).not.toBeNull();
    expect(screen.getByText("本文").closest("header")).toBeNull();
  });

  it("ScreenMenuProviderの中では、メニュー部品、leading、見出しの順にDOMに並ぶ", () => {
    // Given
    // When
    render(
      <ScreenMenuProvider menu={menu}>
        <ScreenFrame title="ホーム" leading={<span>先頭</span>}>
          <p>本文</p>
        </ScreenFrame>
      </ScreenMenuProvider>,
    );

    // Then
    const menuButton = screen.getByRole("button", { name: "メニュー" });
    const leading = screen.getByText("先頭");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(
      menuButton.compareDocumentPosition(leading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      leading.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("ScreenMenuProviderの外では、メニュー部品を出さず、leadingと見出しは出る", () => {
    // Given
    // When
    render(
      <ScreenFrame title="ホーム" leading={<span>先頭</span>}>
        <p>本文</p>
      </ScreenFrame>,
    );

    // Then
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("先頭")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

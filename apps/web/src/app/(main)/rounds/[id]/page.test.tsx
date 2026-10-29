import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RoundPage, { generateStaticParams } from "./page";

// 取得と表示は別のテストで確かめるため、クライアントコンポーネントは目印だけを描画するスタブにする。
const received = vi.hoisted(() => ({
  props: undefined as
    | {
        sessionReader?: { readSession?: unknown };
        identityReader?: { read?: unknown };
      }
    | undefined,
}));
vi.mock("./round-detail-client", () => ({
  RoundDetailClient: (props: NonNullable<typeof received.props>) => {
    received.props = props;
    return <div data-testid="round-detail-client" />;
  },
}));

describe("RoundPage", () => {
  it("取得を伴わず、ラウンド詳細のクライアントコンポーネントだけを描画する", () => {
    // Given

    // When
    render(<RoundPage />);

    // Then
    expect(screen.getByTestId("round-detail-client")).toBeInTheDocument();
  });

  it("サインインの状態と端末の識別情報の読み手を、子へ渡す", () => {
    // Given
    // When
    render(<RoundPage />);

    // Then
    expect(received.props?.sessionReader?.readSession).toBeTypeOf("function");
    expect(received.props?.identityReader?.read).toBeTypeOf("function");
  });

  it("静的な枠にするため、プレースホルダーのIDだけをプリレンダー対象にする", () => {
    // Given

    // When
    const params = generateStaticParams();

    // Then
    expect(params).toEqual([{ id: "_" }]);
  });
});

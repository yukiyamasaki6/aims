import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RoundPage, { generateStaticParams } from "./page";

// 取得と表示は別のテストで確かめるため、クライアントコンポーネントは目印だけを描画するスタブにする。
const received = vi.hoisted(() => ({
  props: undefined as
    | {
        sessionReader?: { readSession?: unknown };
        identityReader?: unknown;
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

  it("サインインの状態の読み手を子へ渡し、端末の識別情報の読み手は渡さない", () => {
    // Given
    // When
    render(<RoundPage />);

    // Then
    expect(received.props?.sessionReader?.readSession).toBeTypeOf("function");
    expect(received.props).not.toHaveProperty("identityReader");
  });

  it("静的な枠にするため、プレースホルダーのIDだけをプリレンダー対象にする", () => {
    // Given

    // When
    const params = generateStaticParams();

    // Then
    expect(params).toEqual([{ id: "_" }]);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RoundPage, { generateStaticParams } from "./page";

// 取得と表示は別のテストで確かめるため、クライアントコンポーネントは目印だけを描画するスタブにする。
vi.mock("./round-detail-client", () => ({
  RoundDetailClient: () => <div data-testid="round-detail-client" />,
}));

describe("RoundPage", () => {
  it("取得を伴わず、ラウンド詳細のクライアントコンポーネントだけを描画する", () => {
    // Given: 同期のコンポーネントで、paramsやcookieやSupabaseを必要としない
    // When: ページを描画する
    render(<RoundPage />);

    // Then
    expect(screen.getByTestId("round-detail-client")).toBeInTheDocument();
  });

  it("静的な枠にするため、プレースホルダーのIDだけをプリレンダー対象にする", () => {
    expect(generateStaticParams()).toEqual([{ id: "_" }]);
  });
});

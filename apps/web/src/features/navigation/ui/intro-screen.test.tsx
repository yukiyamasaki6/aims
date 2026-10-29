import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Start } from "../application/start";
import { IntroScreen } from "./intro-screen";

// 開始ボタンは実物のまま描き、受け取ったpropsだけを記録する。
const received = vi.hoisted(() => ({
  props: undefined as { start?: unknown } | undefined,
}));
vi.mock("./start-button", async () => {
  const actual =
    await vi.importActual<typeof import("./start-button")>("./start-button");
  return {
    StartButton: (props: Parameters<typeof actual.StartButton>[0]) => {
      received.props = props;
      return actual.StartButton(props);
    },
  };
});

// 外部に触れない手書きの偽の手続き。
function createFakeStart(): Start {
  return {
    pendingHref: "/signup-x",
    decideHref: vi.fn().mockResolvedValue("/home-x"),
  };
}

describe("IntroScreen", () => {
  it("アプリ名と説明文、開始ボタン、AIMSロゴを表示する", async () => {
    // Given
    const start = createFakeStart();

    // When
    render(<IntroScreen start={start} />);

    // Then
    expect(screen.getByRole("heading", { name: "AIMS" })).toBeInTheDocument();
    expect(
      screen.getByText("アーチェリーのスコア記録・分析・共有アプリ"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "開始" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AIMS" })).toBeInTheDocument();
    // 開始ボタンの非同期の判定が終わるまで待つ(描画後の状態更新を描画の外に残さない)。
    await vi.waitFor(() =>
      expect(screen.getByRole("link", { name: "開始" })).toHaveAttribute(
        "data-hydrated",
        "true",
      ),
    );
  });

  it("受け取った開始の手続きを、そのまま開始ボタンへ渡す", async () => {
    // Given
    const start = createFakeStart();

    // When
    render(<IntroScreen start={start} />);

    // Then
    expect(received.props?.start).toBe(start);
    await vi.waitFor(() => expect(start.decideHref).toHaveBeenCalled());
  });
});

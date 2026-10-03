import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FetchState } from "./fetch-state";

describe("FetchState", () => {
  describe("正常系", () => {
    it("loadingのとき、取得中であることを示すスケルトンを表示する", () => {
      // Given
      // When
      render(<FetchState view={{ status: "loading" }} onRetry={vi.fn()} />);

      // Then
      expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    });

    it("not-foundのとき、渡したメッセージだけを表示し、リンクを表示しない", () => {
      // Given
      // When
      render(
        <FetchState
          view={{ status: "not-found" }}
          onRetry={vi.fn()}
          notFound={{ message: "ラウンドが見つかりません。" }}
        />,
      );

      // Then
      expect(
        screen.getByText("ラウンドが見つかりません。"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("offlineのとき、未接続と再試行ボタンを表示し、押すとonRetryを呼ぶ", async () => {
      // Given
      const onRetry = vi.fn();
      render(<FetchState view={{ status: "offline" }} onRetry={onRetry} />);
      expect(screen.getByText("未接続")).toBeInTheDocument();

      // When
      await userEvent.click(screen.getByRole("button", { name: "再試行" }));

      // Then
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("errorのとき、messageをalertで表示し、再試行を押すとonRetryを呼ぶ", async () => {
      // Given
      const onRetry = vi.fn();
      render(
        <FetchState
          view={{ status: "error", message: "読み込めませんでした。" }}
          onRetry={onRetry}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );

      // When
      await userEvent.click(screen.getByRole("button", { name: "再試行" }));

      // Then
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("異常系", () => {
    it("not-foundでメッセージを渡さないとき、既定の文言を表示し、リンクを表示しない", () => {
      // Given
      // When
      render(<FetchState view={{ status: "not-found" }} onRetry={vi.fn()} />);

      // Then
      expect(screen.getByText("見つかりませんでした。")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("okを受け取る呼び出しは型エラーになる", () => {
      // Given
      type View = React.ComponentProps<typeof FetchState>["view"];

      // When
      // @ts-expect-error okは画面ごとに描画するため受け取らない
      const ok: View = { status: "ok", data: 1 };

      // Then
      expect(ok.status).toBe("ok");
    });
  });
});

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { LoadedRoundDetail } from "./load-round-detail";
import { loadRoundDetail } from "./load-round-detail";
import { RoundDetailClient } from "./round-detail-client";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ID = "223e4567-e89b-12d3-a456-426614174000";

const nav = vi.hoisted(() => ({ pathname: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace }),
}));

// 取得とスコアカードは別のテストで確かめるため、境界としてモック・スタブにする。
vi.mock("./load-round-detail", () => ({ loadRoundDetail: vi.fn() }));
const load = vi.mocked(loadRoundDetail);
vi.mock("./scorecard-client", () => ({
  ScorecardClient: ({
    roundId,
    initialRoundConfig,
  }: {
    roundId: string;
    initialRoundConfig: { name: string };
  }) => (
    <div data-testid="scorecard" data-round-id={roundId}>
      {initialRoundConfig.name}
    </div>
  ),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

function detail(name: string, leaveRound = false): LoadedRoundDetail {
  return {
    roundConfig: {
      name,
      roundDate: "2026-09-15",
      format: "outdoor",
      bowType: "recurve",
    },
    distances: [],
    shots: [],
    targetFaces: [],
    leaveRound,
  };
}

function resolves(result: FetchResult<LoadedRoundDetail>) {
  load.mockResolvedValue(result);
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = `/rounds/${ID}`;
});

describe("RoundDetailClient", () => {
  describe("取得中", () => {
    it("取得中は、一覧へ戻るリンクと読み込み中の表示を出し、スコアカードは出さない", () => {
      // Given: 取得が完了しない
      load.mockReturnValue(new Promise(() => {}));

      // When
      render(<RoundDetailClient />);

      // Then
      expect(screen.getByRole("link", { name: "一覧へ戻る" })).toHaveAttribute(
        "href",
        "/rounds",
      );
      expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
    });

    it("初回描画は、pathnameによらず同じ取得中の枠で、取得を始めない", () => {
      // Given: SSRで描画される枠(/rounds/_)と、実際のIDのURLで水和する描画
      nav.pathname = "/rounds/_";
      const placeholderHtml = renderToString(<RoundDetailClient />);
      nav.pathname = `/rounds/${ID}`;

      // When: サーバーでの描画（effectは走らない）
      const html = renderToString(<RoundDetailClient />);

      // Then: 水和の不一致を避けるため同一で、取得も始めない
      expect(html).toBe(placeholderHtml);
      expect(html).toContain("読み込み中");
      expect(load).not.toHaveBeenCalled();
    });
  });

  describe("取得できた場合", () => {
    it("pathnameのIDで取得し、取得結果をスコアカードへ渡す", async () => {
      // Given
      resolves({ status: "ok", data: detail("午前練習") });

      // When
      render(<RoundDetailClient />);

      // Then
      const scorecard = await screen.findByTestId("scorecard");
      expect(scorecard).toHaveTextContent("午前練習");
      expect(scorecard).toHaveAttribute("data-round-id", ID);
      expect(load).toHaveBeenCalledTimes(1);
      expect(load.mock.calls[0][1]).toBe(ID);
    });

    it("ラウンドの削除が未送信なら、一覧へ遷移する", async () => {
      resolves({ status: "ok", data: detail("削除済み", true) });

      render(<RoundDetailClient />);

      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/rounds"));
    });

    it("削除が未送信でなければ、遷移しない", async () => {
      resolves({ status: "ok", data: detail("午前練習") });

      render(<RoundDetailClient />);

      await screen.findByTestId("scorecard");
      expect(nav.replace).not.toHaveBeenCalled();
    });

    it("pathnameのIDが変わると、前のラウンドを見せずに取得し直す", async () => {
      // Given: 最初のラウンドを表示している
      resolves({ status: "ok", data: detail("最初") });
      const { rerender } = render(<RoundDetailClient />);
      await screen.findByText("最初");

      // When: 別のラウンドへ移り、取得が完了しない
      load.mockReturnValue(new Promise(() => {}));
      nav.pathname = `/rounds/${OTHER_ID}`;
      rerender(<RoundDetailClient />);

      // Then
      expect(screen.queryByText("最初")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
      expect(load.mock.calls.at(-1)?.[1]).toBe(OTHER_ID);
    });
  });

  describe("見つからない・オフライン・エラー", () => {
    it("見つからない場合は、メッセージと一覧へ戻るリンクを出す", async () => {
      resolves({ status: "not-found" });

      render(<RoundDetailClient />);

      expect(
        await screen.findByText("ラウンドが見つかりません。"),
      ).toBeInTheDocument();
      // 戻る導線は枠のヘッダーの1つだけにする。
      expect(screen.getAllByRole("link", { name: "一覧へ戻る" })).toHaveLength(
        1,
      );
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
    });

    it.each([
      ["プレースホルダー", "/rounds/_"],
      ["UUIDでないID", "/rounds/abc"],
    ])(
      "%sのpathnameは、問い合わせずに見つからないとする",
      async (_name, pathname) => {
        nav.pathname = pathname;

        render(<RoundDetailClient />);

        expect(
          await screen.findByText("ラウンドが見つかりません。"),
        ).toBeInTheDocument();
        expect(load).not.toHaveBeenCalled();
      },
    );

    it("通信できない場合は、一覧へ戻るリンクとネットワークに接続されていませんを出す", async () => {
      resolves({ status: "offline" });

      render(<RoundDetailClient />);

      expect(
        await screen.findByText("ネットワークに接続されていません"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "一覧へ戻る" }),
      ).toBeInTheDocument();
    });

    it("取得エラーの場合はメッセージを出し、再試行で取得し直して表示する", async () => {
      // Given: 1回目はエラー、2回目は成功
      load.mockResolvedValueOnce({
        status: "error",
        message: "読み込めませんでした。",
      });
      load.mockResolvedValueOnce({ status: "ok", data: detail("午前練習") });
      const user = userEvent.setup();
      render(<RoundDetailClient />);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );

      // When
      await act(async () => {
        await user.click(screen.getByRole("button", { name: "再試行" }));
      });

      // Then
      expect(await screen.findByTestId("scorecard")).toHaveTextContent(
        "午前練習",
      );
      expect(load).toHaveBeenCalledTimes(2);
    });
  });
});

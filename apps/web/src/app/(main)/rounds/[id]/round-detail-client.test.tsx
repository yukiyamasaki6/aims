import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FETCH_TIMEOUT_MS } from "@/features/fetch-result/fetch-content";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import { roundTablesFromServer } from "@/features/rounds/round-tables";
import type { TargetFaceOption } from "@/features/rounds/target-face-types";
import type { LoadedRoundDetail } from "./load-round-detail";
import { loadRoundDetail } from "./load-round-detail";
import { RoundDetailClient } from "./round-detail-client";
import { useCreationGone } from "./use-creation-gone";

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
vi.mock("./use-creation-gone", () => ({ useCreationGone: vi.fn() }));
const creationGone = vi.mocked(useCreationGone);
vi.mock("./scorecard-client", () => ({
  ScorecardClient: ({
    roundId,
    loaded,
    targetFaces,
    onGone,
  }: {
    roundId: string;
    loaded: { base: { round: { config: { name: string } } } };
    targetFaces: { id: string }[];
    onGone?: () => void;
  }) => (
    <div
      data-testid="scorecard"
      data-round-id={roundId}
      data-faces={targetFaces.map((f) => f.id).join(",")}
    >
      {loaded.base.round.config.name}
      <button type="button" onClick={onGone}>
        gone
      </button>
    </div>
  ),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

// スコアカードのスタブはidだけを読むため、的はidだけを持たせる。
function faces(...ids: string[]): TargetFaceOption[] {
  return ids.map((id) => ({ id })) as TargetFaceOption[];
}

function detail(
  name: string,
  pendingCreationEventId: string | null = null,
  source: "server" | "local" = "server",
  targetFaces: TargetFaceOption[] = [],
): LoadedRoundDetail {
  return {
    deleted: false,
    base: roundTablesFromServer({
      status: "in_progress",
      roundConfig: {
        name,
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
      distances: [],
      shots: [],
    }),
    group: { base: undefined, entries: [] },
    targetFaces,
    pendingCreationEventId,
    source,
  };
}

function resolves(result: FetchResult<LoadedRoundDetail>) {
  load.mockResolvedValue(result);
}

beforeEach(() => {
  // offlineの結果が返る状況はnavigator.onLineがfalseである(trueのままだと、すぐ再取得する)。
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.clearAllMocks();
  nav.pathname = `/rounds/${ID}`;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RoundDetailClient", () => {
  describe("取得中", () => {
    it("取得中は、一覧へ戻るリンクと読み込み中の表示を出し、スコアカードは出さない", () => {
      // Given
      load.mockReturnValue(new Promise(() => {}));

      // When
      render(<RoundDetailClient />);

      // Then
      expect(
        screen.getByRole("link", { name: "一覧へ戻る" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
    });

    it("初回描画は、pathnameによらず同じ取得中の枠で、取得を始めない", () => {
      // Given
      nav.pathname = "/rounds/_";
      const placeholderHtml = renderToString(<RoundDetailClient />);
      nav.pathname = `/rounds/${ID}`;

      // When
      // サーバーでの描画ではeffectが走らない。
      const html = renderToString(<RoundDetailClient />);

      // Then
      // 水和の不一致を避けるため、サーバーの描画は読み込み中の表示と同一になる。
      expect(html).toBe(placeholderHtml);
      expect(html).toContain("読み込み中");
      expect(load).not.toHaveBeenCalled();
    });
  });

  describe("取得できた場合", () => {
    it("pathnameのIDで取得し、取得結果をスコアカードへ渡す", async () => {
      // Given
      resolves({
        status: "ok",
        data: detail("午前練習", null, "server", faces("face-1", "face-2")),
      });

      // When
      render(<RoundDetailClient />);

      // Then
      const scorecard = await screen.findByTestId("scorecard");
      expect(scorecard).toHaveTextContent("午前練習");
      expect(scorecard).toHaveAttribute("data-round-id", ID);
      expect(scorecard).toHaveAttribute("data-faces", "face-1,face-2");
      expect(load).toHaveBeenCalledTimes(1);
      expect(load.mock.calls[0][1]).toBe(ID);
    });

    it("列に削除があれば、スコアカードを出さず、一覧へ置き換えて遷移する", async () => {
      // Given
      resolves({ status: "ok", data: { deleted: true } });

      // When
      render(<RoundDetailClient />);

      // Then
      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/rounds"));
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
    });

    it("列に削除がなければ、遷移しない", async () => {
      // Given
      resolves({ status: "ok", data: detail("午前練習") });

      // When
      render(<RoundDetailClient />);
      await screen.findByTestId("scorecard");

      // Then
      expect(nav.replace).not.toHaveBeenCalled();
    });

    it("pathnameのIDが変わると、前のラウンドを見せずに取得し直す", async () => {
      // Given
      resolves({ status: "ok", data: detail("最初") });
      const { rerender } = render(<RoundDetailClient />);
      await screen.findByText("最初");
      load.mockReturnValue(new Promise(() => {}));

      // When
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
      // Given
      resolves({ status: "not-found" });

      // When
      render(<RoundDetailClient />);

      // Then
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
        // Given
        nav.pathname = pathname;

        // When
        render(<RoundDetailClient />);

        // Then
        expect(
          await screen.findByText("ラウンドが見つかりません。"),
        ).toBeInTheDocument();
        expect(load).not.toHaveBeenCalled();
      },
    );

    it("通信できない場合は、一覧へ戻るリンクとネットワークに接続されていませんを出す", async () => {
      // Given
      resolves({ status: "offline" });

      // When
      render(<RoundDetailClient />);

      // Then
      expect(
        await screen.findByText("ネットワークに接続されていません"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "一覧へ戻る" }),
      ).toBeInTheDocument();
    });

    it("取得エラーの場合は、メッセージと再試行ボタンを出す", async () => {
      // Given
      load.mockResolvedValue({
        status: "error",
        message: "読み込めませんでした。",
      });

      // When
      render(<RoundDetailClient />);

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );
      expect(
        screen.getByRole("button", { name: "再試行" }),
      ).toBeInTheDocument();
    });

    it("取得エラーの後に再試行すると、取得し直して表示する", async () => {
      // Given
      load.mockResolvedValueOnce({
        status: "error",
        message: "読み込めませんでした。",
      });
      load.mockResolvedValueOnce({ status: "ok", data: detail("午前練習") });
      const user = userEvent.setup();
      render(<RoundDetailClient />);
      const retry = await screen.findByRole("button", { name: "再試行" });

      // When
      await act(async () => {
        await user.click(retry);
      });

      // Then
      expect(await screen.findByTestId("scorecard")).toHaveTextContent(
        "午前練習",
      );
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("読み込みが終わらないときは、FETCH_TIMEOUT_MSの前は読み込み中で、FETCH_TIMEOUT_MSで一覧へ戻るリンクとエラーと再試行ボタンを表示し、読み込み中の表示を消す", async () => {
      // Given
      vi.useFakeTimers();
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      load.mockReturnValue(new Promise(() => {}));
      render(<RoundDetailClient />);

      // When
      await act(() => vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1));
      const busyBeforeLimit = screen
        .getByRole("status")
        .getAttribute("aria-busy");
      await act(() => vi.advanceTimersByTimeAsync(1));

      // Then
      expect(busyBeforeLimit).toBe("true");
      expect(
        screen.getByRole("link", { name: "一覧へ戻る" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );
      expect(
        screen.getByRole("button", { name: "再試行" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
    });
  });

  describe("端末のベースで開いたラウンド", () => {
    it("端末のベースで開いたときは、読み込みの結果の的をスコアカードへ渡す", async () => {
      // Given
      resolves({
        status: "ok",
        data: detail("入力中", null, "local", faces("face-1")),
      });

      // When
      render(<RoundDetailClient />);

      // Then
      expect(await screen.findByTestId("scorecard")).toHaveAttribute(
        "data-faces",
        "face-1",
      );
    });

    it("端末のベースで開いた後に、サーバーにラウンドが無いと分かったら、一覧へ置き換える", async () => {
      // Given
      resolves({
        status: "ok",
        data: detail("入力中", null, "local", faces("face-1")),
      });
      const user = userEvent.setup();
      render(<RoundDetailClient />);
      const gone = await screen.findByRole("button", { name: "gone" });

      // When
      await user.click(gone);

      // Then
      expect(nav.replace).toHaveBeenCalledWith("/rounds");
    });
  });

  describe("作成が未確定のラウンド", () => {
    const pendingEventId = "event-1";

    it("読み込みの結果の的をスコアカードへ渡す", async () => {
      // Given
      resolves({
        status: "ok",
        data: detail(
          "作成中",
          pendingEventId,
          "server",
          faces("face-1", "face-2"),
        ),
      });

      // When
      render(<RoundDetailClient />);

      // Then
      expect(await screen.findByTestId("scorecard")).toHaveAttribute(
        "data-faces",
        "face-1,face-2",
      );
    });

    it("作成が未確定なら、作成の消失の監視へラウンドIDと未確定のeventIdを渡す", async () => {
      // Given
      resolves({ status: "ok", data: detail("作成中", pendingEventId) });

      // When
      render(<RoundDetailClient />);
      await screen.findByTestId("scorecard");

      // Then
      const [roundId, eventId] = creationGone.mock.calls.at(-1) ?? [];
      expect(roundId).toBe(ID);
      expect(eventId).toBe(pendingEventId);
    });

    it("作成の消失を検知したら、取得し直す", async () => {
      // Given
      resolves({ status: "ok", data: detail("作成中", pendingEventId) });
      render(<RoundDetailClient />);
      await screen.findByTestId("scorecard");
      const [, , onGone] = creationGone.mock.calls.at(-1) ?? [];
      const before = load.mock.calls.length;

      // When
      await act(async () => {
        onGone?.();
      });

      // Then
      await waitFor(() => expect(load.mock.calls.length).toBe(before + 1));
    });
  });
});

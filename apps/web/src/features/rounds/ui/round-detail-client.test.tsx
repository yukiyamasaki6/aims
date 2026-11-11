import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoundScreen } from "@/features/rounds/application/round-window";
import type { FetchView } from "@/features/rounds/domain/fetch-status";
import { roundTablesFromServer } from "@/features/rounds/domain/round-op-test-helpers";
import { selectRoundState } from "@/features/rounds/domain/round-tables";
import type { TargetFaceOption } from "@/features/rounds/domain/target-face";
import {
  createFakeRoundProcedures,
  createFakeRoundWindow,
} from "@/features/rounds/ui/round-stores-test-helpers";
import {
  RoundProceduresProvider,
  RoundWindowProvider,
} from "@/features/rounds/ui/rounds-context";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { RoundDetailClient } from "./round-detail-client";

const roundsText = translatorFor("rounds");

const ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ID = "223e4567-e89b-12d3-a456-426614174000";

const nav = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

// 取得・存在の判断・再試行は窓口のテストで確かめるため、窓口は偽に、スコアカードはスタブにする。
const fake = createFakeRoundWindow();
// offlineの結果が返る状況は通信が切れている(切れていないと、すぐ再取得する)。
const procedures = createFakeRoundProcedures();
procedures.goOffline();

function Providers({ children }: { children: ReactNode }) {
  return (
    <RoundWindowProvider roundWindow={fake.roundWindow}>
      <RoundProceduresProvider procedures={procedures}>
        {children}
      </RoundProceduresProvider>
    </RoundWindowProvider>
  );
}

vi.mock("./scorecard-client", () => ({
  ScorecardClient: ({
    roundId,
    screen,
    append,
  }: {
    roundId: string;
    screen: {
      state: { roundConfig: { name: string } };
      targetFaces: { id: string }[];
    };
    append: (operation: unknown) => unknown;
  }) => (
    <div
      data-testid="scorecard"
      data-round-id={roundId}
      data-faces={screen.targetFaces.map((f) => f.id).join(",")}
    >
      {screen.state.roundConfig.name}
      <button type="button" onClick={() => append({ type: "probe" })}>
        append
      </button>
    </div>
  ),
}));

// スコアカードのスタブはidだけを読むため、的はidだけを持たせる。
function faces(...ids: string[]): TargetFaceOption[] {
  return ids.map((id) => ({ id })) as TargetFaceOption[];
}

function ready(
  name: string,
  targetFaces: TargetFaceOption[] = [],
): FetchView<RoundScreen> {
  return {
    status: "ok",
    data: {
      state: selectRoundState(
        roundTablesFromServer({
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
      ),
      targetFaces,
      initiallyEmpty: true,
    },
  };
}

function renderDetail() {
  return render(
    <Providers>
      <RoundDetailClient />
    </Providers>,
    { wrapper: IntlTestProvider },
  );
}

function renderDetailToString() {
  return renderToString(
    <IntlTestProvider>
      <Providers>
        <RoundDetailClient />
      </Providers>
    </IntlTestProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = `/rounds/${ID}`;
  fake.setView(ID, { status: "loading" });
  fake.setView(OTHER_ID, { status: "loading" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RoundDetailClient", () => {
  describe("取得中", () => {
    it("取得中は、戻るリンクと読み込み中の表示を出し、スコアカードは出さない", () => {
      // Given

      // When
      renderDetail();

      // Then
      expect(
        screen.getByRole("link", { name: roundsText("back") }),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
    });

    it("初回描画は、pathnameによらず同じ取得中の枠で、購読を始めない", () => {
      // Given
      fake.setView(ID, ready("すでに準備完了"));
      nav.pathname = "/rounds/_";
      const placeholderHtml = renderDetailToString();
      nav.pathname = `/rounds/${ID}`;

      // When
      // サーバーでの描画ではeffectが走らない。
      const html = renderDetailToString();

      // Then
      // 水和の不一致を避けるため、サーバーの描画は読み込み中の表示と同一になる(窓口に値があっても出さない)。
      expect(html).toBe(placeholderHtml);
      expect(html).toContain(roundsText("fetchLoading"));
      expect(fake.roundWindow.watch).not.toHaveBeenCalled();
    });
  });

  describe("準備完了", () => {
    it("pathnameのIDを購読し、窓口の状態をスコアカードへ渡し、追記は窓口へ渡す", async () => {
      // Given
      fake.setView(ID, ready("午前練習", faces("face-1", "face-2")));
      const user = userEvent.setup();

      // When
      renderDetail();
      await user.click(await screen.findByRole("button", { name: "append" }));

      // Then
      const scorecard = screen.getByTestId("scorecard");
      expect(scorecard).toHaveTextContent("午前練習");
      expect(scorecard).toHaveAttribute("data-round-id", ID);
      expect(scorecard).toHaveAttribute("data-faces", "face-1,face-2");
      expect(fake.roundWindow.watch).toHaveBeenCalledWith(
        ID,
        expect.any(Function),
      );
      expect(fake.roundWindow.append).toHaveBeenCalledWith(ID, {
        type: "probe",
      });
    });

    it("窓口の状態が変わると描画し直し、画面を閉じると購読を解除する", () => {
      // Given
      const { unmount } = renderDetail();
      const before = screen.queryByTestId("scorecard");

      // When
      act(() => fake.setView(ID, ready("更新後")));
      const after = screen.getByTestId("scorecard");
      unmount();

      // Then
      expect(before).toBeNull();
      expect(after).toHaveTextContent("更新後");
      const stop = fake.roundWindow.watch.mock.results[0].value as () => void;
      expect(stop).toBeTypeOf("function");
    });

    it("pathnameのIDが変わると、前のラウンドを見せずに、新しいIDを購読する", async () => {
      // Given
      fake.setView(ID, ready("最初"));
      const { rerender } = renderDetail();
      await screen.findByText("最初");

      // When
      nav.pathname = `/rounds/${OTHER_ID}`;
      rerender(
        <Providers>
          <RoundDetailClient />
        </Providers>,
      );

      // Then
      expect(screen.queryByText("最初")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
      expect(fake.roundWindow.watch).toHaveBeenLastCalledWith(
        OTHER_ID,
        expect.any(Function),
      );
    });

    it("準備完了の後に窓口が見つからないにすると、スコアカードを閉じて、見つからない表示と戻るリンクを出す", () => {
      // Given
      fake.setView(ID, ready(roundsText("homeEmpty"), faces("face-1")));
      renderDetail();

      // When
      act(() => fake.setView(ID, { status: "not-found" }));

      // Then
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
      expect(screen.getByText(roundsText("detailNotFound"))).toBeVisible();
      expect(
        screen.getByRole("link", { name: roundsText("back") }),
      ).toBeVisible();
    });
  });

  describe("見つからない・オフライン・エラー", () => {
    it("見つからない場合は、メッセージと戻るリンクを出す", () => {
      // Given
      fake.setView(ID, { status: "not-found" });

      // When
      renderDetail();

      // Then
      expect(screen.getByText(roundsText("detailNotFound"))).toBeVisible();
      // 戻る導線は枠のヘッダーの1つだけにする。
      expect(
        screen.getAllByRole("link", { name: roundsText("back") }),
      ).toHaveLength(1);
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
    });

    it.each([
      ["プレースホルダー", "/rounds/_"],
      ["UUIDでないID", "/rounds/abc"],
    ])(
      "%sのpathnameは、購読せずに見つからないとする",
      async (_name, pathname) => {
        // Given
        nav.pathname = pathname;

        // When
        renderDetail();

        // Then
        expect(
          await screen.findByText(roundsText("detailNotFound")),
        ).toBeInTheDocument();
        expect(fake.roundWindow.watch).not.toHaveBeenCalled();
      },
    );

    it("オフラインとエラーの表示を出し、再試行は窓口のretryを呼ぶ", async () => {
      // Given
      fake.setView(ID, { status: "error", reason: "failed" });
      const user = userEvent.setup();
      renderDetail();
      const retry = await screen.findByRole("button", {
        name: roundsText("fetchRetry"),
      });

      // When
      await act(async () => {
        await user.click(retry);
      });

      // Then
      expect(fake.roundWindow.retry).toHaveBeenCalledExactlyOnceWith(ID);
    });

    it("オフラインのとき、オフラインの表示を出す", () => {
      // Given
      fake.setView(ID, { status: "offline" });

      // When
      renderDetail();

      // Then
      expect(screen.getByText(roundsText("fetchOffline"))).toBeVisible();
    });
  });
});

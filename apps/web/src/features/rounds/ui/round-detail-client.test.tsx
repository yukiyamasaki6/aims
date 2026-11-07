import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LoadedRoundDetail,
  RoundDetailStore,
} from "@/features/rounds/application/round-detail-store";
import type { FetchResult } from "@/features/rounds/domain/fetch-status";
import { roundTablesFromServer } from "@/features/rounds/domain/round-tables";
import type { TargetFaceOption } from "@/features/rounds/domain/target-face";
import {
  createFakeRoundDetailStore,
  createFakeRoundProcedures,
} from "@/features/rounds/ui/round-stores-test-helpers";
import {
  RoundDetailStoreProvider,
  RoundProceduresProvider,
} from "@/features/rounds/ui/rounds-context";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { RoundDetailClient } from "./round-detail-client";
import { useCreationGone } from "./use-creation-gone";

const roundsText = translatorFor("rounds");

const ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ID = "223e4567-e89b-12d3-a456-426614174000";

const nav = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

// 取得とスコアカードは別のテストで確かめるため、ラウンドの状態は読み込みだけを返す偽の約束に、スコアカードはスタブにする。
const load = vi.fn<RoundDetailStore["load"]>();
// offlineの結果が返る状況は通信が切れている(切れていないと、すぐ再取得する)。
const fake = createFakeRoundDetailStore({ load });
fake.goOffline();
const store = fake.store;
const procedures = createFakeRoundProcedures();

function Providers({ children }: { children: ReactNode }) {
  return (
    <RoundDetailStoreProvider store={store}>
      <RoundProceduresProvider procedures={procedures}>
        {children}
      </RoundProceduresProvider>
    </RoundDetailStoreProvider>
  );
}
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
    targetFaces,
    pendingCreationEventId,
    source,
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

function resolves(result: FetchResult<LoadedRoundDetail>) {
  load.mockResolvedValue(result);
}

beforeEach(() => {
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
      renderDetail();

      // Then
      expect(
        screen.getByRole("link", { name: roundsText("backToList") }),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
    });

    it("初回描画は、pathnameによらず同じ取得中の枠で、取得を始めない", () => {
      // Given
      nav.pathname = "/rounds/_";
      const placeholderHtml = renderDetailToString();
      nav.pathname = `/rounds/${ID}`;

      // When
      // サーバーでの描画ではeffectが走らない。
      const html = renderDetailToString();

      // Then
      // 水和の不一致を避けるため、サーバーの描画は読み込み中の表示と同一になる。
      expect(html).toBe(placeholderHtml);
      expect(html).toContain(roundsText("fetchLoading"));
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
      renderDetail();

      // Then
      const scorecard = await screen.findByTestId("scorecard");
      expect(scorecard).toHaveTextContent("午前練習");
      expect(scorecard).toHaveAttribute("data-round-id", ID);
      expect(scorecard).toHaveAttribute("data-faces", "face-1,face-2");
      expect(load).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledWith(ID);
    });

    it("列に削除があれば、スコアカードを出さず、一覧へ戻る手続きを呼ぶ", async () => {
      // Given
      resolves({ status: "ok", data: { deleted: true } });

      // When
      renderDetail();

      // Then
      await waitFor(() =>
        expect(procedures.leaving.leaveRound).toHaveBeenCalledTimes(1),
      );
      expect(screen.queryByTestId("scorecard")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
    });

    it("列に削除がなければ、一覧へ戻る手続きを呼ばない", async () => {
      // Given
      resolves({ status: "ok", data: detail("午前練習") });

      // When
      renderDetail();
      await screen.findByTestId("scorecard");

      // Then
      expect(procedures.leaving.leaveRound).not.toHaveBeenCalled();
    });

    it("pathnameのIDが変わると、前のラウンドを見せずに取得し直す", async () => {
      // Given
      resolves({ status: "ok", data: detail("最初") });
      const { rerender } = renderDetail();
      await screen.findByText("最初");
      load.mockReturnValue(new Promise(() => {}));

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
      expect(load).toHaveBeenLastCalledWith(OTHER_ID);
    });
  });

  describe("見つからない・オフライン・エラー", () => {
    it("見つからない場合は、メッセージと一覧へ戻るリンクを出す", async () => {
      // Given
      resolves({ status: "not-found" });

      // When
      renderDetail();

      // Then
      expect(
        await screen.findByText(roundsText("detailNotFound")),
      ).toBeInTheDocument();
      // 戻る導線は枠のヘッダーの1つだけにする。
      expect(
        screen.getAllByRole("link", { name: roundsText("backToList") }),
      ).toHaveLength(1);
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
        renderDetail();

        // Then
        expect(
          await screen.findByText(roundsText("detailNotFound")),
        ).toBeInTheDocument();
        expect(load).not.toHaveBeenCalled();
      },
    );

    it("取得エラーの後に再試行すると、取得し直して表示する", async () => {
      // Given
      load.mockResolvedValueOnce({
        status: "error",
        reason: "failed",
      });
      load.mockResolvedValueOnce({ status: "ok", data: detail("午前練習") });
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
      expect(await screen.findByTestId("scorecard")).toHaveTextContent(
        "午前練習",
      );
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("端末のベースで開いた後に、サーバーにラウンドが無いと分かったら、一覧へ戻る手続きを呼ぶ", async () => {
      // Given
      resolves({
        status: "ok",
        data: detail(
          roundsText("listInProgress"),
          null,
          "local",
          faces("face-1"),
        ),
      });
      const user = userEvent.setup();
      renderDetail();
      const gone = await screen.findByRole("button", { name: "gone" });

      // When
      await user.click(gone);

      // Then
      expect(procedures.leaving.leaveRound).toHaveBeenCalledTimes(1);
    });
  });

  describe("作成が未確定のラウンド", () => {
    const pendingEventId = "event-1";

    it("作成の消失の監視へラウンドIDを渡す", async () => {
      // Given
      resolves({ status: "ok", data: detail("作成中", pendingEventId) });

      // When
      renderDetail();
      await screen.findByTestId("scorecard");

      // Then
      const [roundId] = creationGone.mock.calls.at(-1) ?? [];
      expect(roundId).toBe(ID);
    });

    it("作成の消失を検知したら、取得し直す", async () => {
      // Given
      resolves({ status: "ok", data: detail("作成中", pendingEventId) });
      renderDetail();
      await screen.findByTestId("scorecard");
      const [, onGone] = creationGone.mock.calls.at(-1) ?? [];
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

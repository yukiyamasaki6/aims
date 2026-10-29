import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FETCH_TIMEOUT_MS } from "@/features/fetch-result/fetch-content";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import type { RoundListItem } from "./fetch-rounds-list";
import {
  type LoadedRoundsList,
  type LocalRoundsList,
  loadRoundsList,
} from "./load-rounds-list";
import { RoundsListClient } from "./rounds-list-client";

// 一覧の読み込みは別のテストで確かめるため、境界としてモックする。
vi.mock("./load-rounds-list", () => ({ loadRoundsList: vi.fn() }));
const load = vi.mocked(loadRoundsList);

// 端末の入力中のラウンドの読み込みと待ちは別のテストで確かめるため、境界としてモックする。
const localList = vi.hoisted(() => ({
  state: {
    local: null as LocalRoundsList | null,
    waited: false,
  },
}));
vi.mock("./use-local-rounds-list", () => ({
  useLocalRoundsList: () => localList.state,
}));

// 削除は列への入り口の先で行うため、境界としてモックする。
const deletion = vi.hoisted(() => ({ deleteRound: vi.fn() }));
vi.mock("./_shared/delete-round", () => deletion);

// 削除の確定は、削除の印として端末の組へ渡る。
const log = vi.hoisted(() => ({ commitDeleted: vi.fn() }));
vi.mock("@/features/rounds/round-op-log", () => ({ roundOpLog: log }));

vi.mock("@/lib/supabase/infrastructure/client", () => ({
  createClient: () => ({}),
}));

const sessionReader = { readSession: vi.fn() };
const identityReader = { read: vi.fn() };

function loaded(
  items: RoundListItem[],
  overrides: Partial<LoadedRoundsList> = {},
): LoadedRoundsList {
  return {
    items,
    inProgress: [],
    deleted: new Set(),
    confirmedDeletions: [],
    startedAt: 100,
    ...overrides,
  };
}

function fetchResolves(result: FetchResult<RoundListItem[]>) {
  load.mockResolvedValue(
    result.status === "ok"
      ? { status: "ok", data: loaded(result.data) }
      : result,
  );
}

const rounds: RoundListItem[] = [
  { id: "round-1", name: "午前練習", roundDate: "2026-09-15", total: 300 },
  { id: "round-2", name: "午後練習", roundDate: "2026-09-16", total: 280 },
];

async function openDeleteDialog(
  user: ReturnType<typeof userEvent.setup>,
  roundName: string,
) {
  const item = screen.getByText(roundName).closest("li");
  if (!item) throw new Error(`round item not found: ${roundName}`);
  await user.click(within(item).getByTestId("round-menu-trigger"));
  await user.click(await screen.findByTestId("round-delete"));
}

const roundsWithUnnamed: RoundListItem[] = [
  rounds[0],
  { id: "round-9", name: "", roundDate: "2026-09-17", total: 100 },
];

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  roundDate: string,
) {
  const item = screen.getByText(roundDate).closest("li");
  if (!item) throw new Error(`round item not found: ${roundDate}`);
  await user.click(within(item).getByTestId("round-menu-trigger"));
}

const inProgressRounds: RoundListItem[] = [
  { id: "round-3", name: "入力中の練習", roundDate: "2026-09-10", total: 120 },
];

function offlineWithLocal(items: RoundListItem[] = inProgressRounds) {
  localList.state = {
    local: { inProgress: items, deleted: new Set() },
    waited: false,
  };
}

beforeEach(() => {
  // offlineの結果が返る状況はnavigator.onLineがfalseである(trueのままだと、すぐ再取得する)。
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.clearAllMocks();
  localList.state = { local: null, waited: false };
  deletion.deleteRound.mockResolvedValue(undefined);
  log.commitDeleted.mockResolvedValue({ base: undefined, entries: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RoundsListClient", () => {
  describe("一覧の表示", () => {
    it("取得中は、読み込み中の表示と新規作成ボタンを表示する", () => {
      // Given
      load.mockReturnValue(new Promise(() => {}));

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(
        screen.queryByText("まだラウンドがありません。"),
      ).not.toBeInTheDocument();
    });

    it("取得できたラウンドをカードで表示し、新規作成ボタンも表示する", async () => {
      // Given
      fetchResolves({ status: "ok", data: rounds });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(screen.getByText("2026-09-15")).toBeInTheDocument();
      expect(screen.getByText("300点")).toBeInTheDocument();
      expect(screen.getByText("午後練習")).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("ラウンドが0件の場合は空状態メッセージを表示する", async () => {
      // Given
      fetchResolves({ status: "ok", data: [] });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      expect(
        await screen.findByText("まだラウンドがありません。"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
    });

    it("通信できない場合はネットワークに接続されていませんを表示し、空状態は表示せず、新規作成ボタンは表示する", async () => {
      // Given
      fetchResolves({ status: "offline" });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      expect(
        await screen.findByText("ネットワークに接続されていません"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(
        screen.queryByText("まだラウンドがありません。"),
      ).not.toBeInTheDocument();
    });

    it("取得がエラーの場合はエラーメッセージを表示し、空状態は表示せず、新規作成ボタンは表示する", async () => {
      // Given
      fetchResolves({ status: "error", message: "読み込めませんでした。" });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
      expect(
        screen.queryByText("まだラウンドがありません。"),
      ).not.toBeInTheDocument();
    });

    it("読み込みが終わらないときは、FETCH_TIMEOUT_MSの前は読み込み中で、FETCH_TIMEOUT_MSでエラーと再試行ボタンを表示し、読み込み中の表示を消す", async () => {
      // Given
      vi.useFakeTimers();
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
      load.mockReturnValue(new Promise(() => {}));
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // When
      await act(() => vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1));
      const busyBeforeLimit = screen
        .getByRole("status")
        .getAttribute("aria-busy");
      await act(() => vi.advanceTimersByTimeAsync(1));

      // Then
      expect(busyBeforeLimit).toBe("true");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );
      expect(
        screen.getByRole("button", { name: "再試行" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
    });

    it("再試行すると取得し直し、取得できた一覧を表示する", async () => {
      // Given
      load
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({ status: "ok", data: loaded(rounds) });
      const user = userEvent.setup();
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      const retry = await screen.findByRole("button", { name: "再試行" });

      // When
      await user.click(retry);

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(load).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText("ネットワークに接続されていません"),
      ).not.toBeInTheDocument();
    });
  });

  describe("端末の列", () => {
    it("列で削除済みのラウンドを表示しない", async () => {
      // Given
      load.mockResolvedValue({
        status: "ok",
        data: loaded(rounds, { deleted: new Set(["round-1"]) }),
      });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      expect(await screen.findByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
    });

    it("取得の前に削除が確定していたラウンドを、削除の印として端末の組へ反映する", async () => {
      // Given
      load.mockResolvedValue({
        status: "ok",
        data: loaded(rounds, {
          deleted: new Set(["round-1"]),
          confirmedDeletions: ["round-1"],
        }),
      });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("午後練習");

      // Then
      // 表示後の処理で呼ばれるため、呼び出しを待って確認する。
      await waitFor(() => {
        expect(log.commitDeleted).toHaveBeenCalledWith("round-1", 100);
      });
    });
  });

  describe("ラウンドの削除", () => {
    it("確認すると、そのラウンドを削除し、ダイアログがすぐ閉じ、一覧から取り除く", async () => {
      // Given
      // 削除の保存は終わらない。
      deletion.deleteRound.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      fetchResolves({ status: "ok", data: rounds });
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("午前練習");
      await openDeleteDialog(user, "午前練習");
      expect(
        screen.getByText(
          "「午前練習」を削除しますか？記録したスコアもすべて失われます。",
        ),
      ).toBeInTheDocument();

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(deletion.deleteRound).toHaveBeenCalledWith("round-1");
      await waitFor(() => {
        expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
      });
      expect(screen.getByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("キャンセルすると削除確認を閉じ、削除せず、一覧に残す", async () => {
      // Given
      const user = userEvent.setup();
      fetchResolves({ status: "ok", data: rounds });
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("午前練習");
      await openDeleteDialog(user, "午前練習");

      // When
      await user.click(screen.getByTestId("confirm-dialog-cancel"));

      // Then
      await waitFor(() => {
        expect(screen.queryByTestId("confirm-dialog-cancel")).toBeNull();
      });
      expect(deletion.deleteRound).not.toHaveBeenCalled();
      expect(screen.getByText("午前練習")).toBeInTheDocument();
    });

    it("名前の有るラウンドのメニューボタンは名前を引用し、名前の無いラウンドのメニューボタンは「ラウンドのメニュー」にする", async () => {
      // Given
      fetchResolves({ status: "ok", data: roundsWithUnnamed });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("2026-09-17");

      // Then
      expect(
        screen.getByRole("button", { name: "「午前練習」のメニュー" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "ラウンドのメニュー" }),
      ).toBeInTheDocument();
    });

    it("名前の無いラウンドの削除確認は、名前を引用しない", async () => {
      // Given
      const user = userEvent.setup();
      fetchResolves({ status: "ok", data: roundsWithUnnamed });
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("2026-09-17");
      await openMenu(user, "2026-09-17");

      // When
      await user.click(await screen.findByTestId("round-delete"));

      // Then
      expect(
        screen.getByText(
          "このラウンドを削除しますか？記録したスコアもすべて失われます。",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/「」/)).toBeNull();
    });

    it("名前の無いラウンドも、確認すると削除し、一覧から消す", async () => {
      // Given
      const user = userEvent.setup();
      fetchResolves({ status: "ok", data: roundsWithUnnamed });
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("2026-09-17");
      await openMenu(user, "2026-09-17");
      await user.click(await screen.findByTestId("round-delete"));

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(deletion.deleteRound).toHaveBeenCalledWith("round-9");
      await waitFor(() => {
        expect(screen.queryByText("2026-09-17")).not.toBeInTheDocument();
      });
      expect(screen.getByText("午前練習")).toBeInTheDocument();
    });
  });

  describe("入力中の領域", () => {
    it("取得が成功し、入力中のラウンドがあれば、見出し「入力中」の領域に表示し、その下に見出し「過去履歴」と入力中でないラウンドを表示する", async () => {
      // Given
      load.mockResolvedValue({
        status: "ok",
        data: loaded([...rounds, ...inProgressRounds], {
          inProgress: inProgressRounds,
        }),
      });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      const area = await screen.findByTestId("in-progress-rounds");
      expect(
        within(area).getByRole("heading", { name: "入力中" }),
      ).toBeInTheDocument();
      expect(within(area).getByText("入力中の練習")).toBeInTheDocument();
      expect(within(area).queryByText("午前練習")).not.toBeInTheDocument();
      const others = screen.getByTestId("other-rounds");
      expect(
        within(others).getByRole("heading", { name: "過去履歴" }),
      ).toBeInTheDocument();
      expect(within(others).getByText("午前練習")).toBeInTheDocument();
      expect(
        within(others).queryByText("入力中の練習"),
      ).not.toBeInTheDocument();
      expect(
        area.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
    });

    it("入力中のラウンドが無ければ、領域も見出しも表示せず、今と同じ表示にする", async () => {
      // Given
      fetchResolves({ status: "ok", data: rounds });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("午前練習");

      // Then
      expect(screen.queryByTestId("in-progress-rounds")).toBeNull();
      expect(screen.queryByTestId("other-rounds")).toBeNull();
      expect(screen.queryByRole("heading", { name: "入力中" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "過去履歴" })).toBeNull();
    });

    it("入力中のラウンドだけがあるときは、「過去履歴」の節も「まだラウンドがありません。」も表示しない", async () => {
      // Given
      load.mockResolvedValue({
        status: "ok",
        data: loaded(inProgressRounds, { inProgress: inProgressRounds }),
      });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByTestId("in-progress-rounds");

      // Then
      expect(screen.queryByTestId("other-rounds")).toBeNull();
      expect(screen.queryByText("まだラウンドがありません。")).toBeNull();
    });

    it("オフラインでは、入力中のラウンドを表示し、「過去履歴」の下に「ネットワークに接続されていません」を表示する", async () => {
      // Given
      offlineWithLocal();
      fetchResolves({ status: "offline" });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      const area = await screen.findByTestId("in-progress-rounds");
      expect(within(area).getByText("入力中の練習")).toBeInTheDocument();
      const others = screen.getByTestId("other-rounds");
      expect(
        within(others).getByRole("heading", { name: "過去履歴" }),
      ).toBeInTheDocument();
      expect(
        within(others).getByText("ネットワークに接続されていません"),
      ).toBeInTheDocument();
      expect(screen.queryByText("まだラウンドがありません。")).toBeNull();
    });

    it("取得に失敗したときは、入力中のラウンドを表示し、「過去履歴」の下にエラーと再試行を表示する", async () => {
      // Given
      offlineWithLocal();
      fetchResolves({ status: "error", message: "読み込めませんでした。" });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByTestId("in-progress-rounds");

      // Then
      const others = screen.getByTestId("other-rounds");
      expect(within(others).getByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );
      expect(
        within(others).getByRole("button", { name: "再試行" }),
      ).toBeInTheDocument();
    });

    it("取得中は、待つ間は入力中の領域を表示せず、待った後は入力中の領域と「過去履歴」の下のスケルトンを表示する", () => {
      // Given
      load.mockReturnValue(new Promise(() => {}));
      offlineWithLocal();

      // When
      const { rerender } = render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      const shownBeforeWait =
        screen.queryByTestId("in-progress-rounds") !== null;
      const loadingBeforeWait = screen.queryByRole("status") !== null;
      // 待ちの経過は、useLocalRoundsListのwaitedが真になることで表す。
      localList.state = { ...localList.state, waited: true };
      rerender(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      expect(shownBeforeWait).toBe(false);
      expect(loadingBeforeWait).toBe(true);
      const area = screen.getByTestId("in-progress-rounds");
      expect(within(area).getByText("入力中の練習")).toBeInTheDocument();
      expect(
        within(screen.getByTestId("other-rounds")).getByRole("status"),
      ).toBeInTheDocument();
    });

    it("入力中がなく取得できないときは、今と同じ表示で、見出しも「まだラウンドがありません。」も表示しない", async () => {
      // Given
      localList.state = {
        local: { inProgress: [], deleted: new Set() },
        waited: true,
      };
      fetchResolves({ status: "offline" });

      // When
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("ネットワークに接続されていません");

      // Then
      expect(screen.queryByTestId("in-progress-rounds")).toBeNull();
      expect(screen.queryByTestId("other-rounds")).toBeNull();
      expect(screen.queryByText("まだラウンドがありません。")).toBeNull();
    });

    it("入力中のラウンドのカードも削除でき、最後の1件を消すと領域が見出しごと消える", async () => {
      // Given
      offlineWithLocal();
      fetchResolves({ status: "offline" });
      const user = userEvent.setup();
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("入力中の練習");
      await openDeleteDialog(user, "入力中の練習");

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(deletion.deleteRound).toHaveBeenCalledWith("round-3");
      await waitFor(() => {
        expect(screen.queryByTestId("in-progress-rounds")).toBeNull();
      });
      expect(screen.queryByRole("heading", { name: "入力中" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "過去履歴" })).toBeNull();
    });

    it("削除したラウンドは、再試行で取得が変わっても表示しない", async () => {
      // Given
      offlineWithLocal();
      load.mockResolvedValueOnce({ status: "offline" }).mockResolvedValueOnce({
        status: "ok",
        data: loaded([...rounds, ...inProgressRounds], {
          inProgress: inProgressRounds,
        }),
      });
      const user = userEvent.setup();
      render(
        <RoundsListClient
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("入力中の練習");
      await openDeleteDialog(user, "入力中の練習");
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // When
      await user.click(await screen.findByRole("button", { name: "再試行" }));

      // Then
      expect(await screen.findByText("午前練習")).toBeInTheDocument();
      expect(screen.queryByText("入力中の練習")).toBeNull();
    });
  });
});

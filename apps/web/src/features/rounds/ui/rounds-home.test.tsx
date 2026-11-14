import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { RoundListItem } from "../domain/round-list";
import {
  createFakeRoundProcedures,
  createFakeRoundsListStore,
  createFakeRoundWindow,
} from "./round-stores-test-helpers";
import {
  RoundProceduresProvider,
  RoundsListStoreProvider,
  RoundWindowProvider,
} from "./rounds-context";
import { RoundsHome } from "./rounds-home";

const roundsText = translatorFor("rounds");

// ホームは端末の記録だけを表示する。履歴の取得(loadList)を呼ばないことを確かめるため、取得の窓口も渡す。
let fake: ReturnType<typeof createFakeRoundsListStore>;
let fakeWindow: ReturnType<typeof createFakeRoundWindow>;
let procedures: ReturnType<typeof createFakeRoundProcedures>;

function renderHome() {
  return render(
    <RoundWindowProvider roundWindow={fakeWindow.roundWindow}>
      <RoundsListStoreProvider store={fake.store}>
        <RoundProceduresProvider procedures={procedures}>
          <RoundsHome />
        </RoundProceduresProvider>
      </RoundsListStoreProvider>
    </RoundWindowProvider>,
    { wrapper: IntlTestProvider },
  );
}

const inProgress: RoundListItem[] = [
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

beforeEach(() => {
  fake = createFakeRoundsListStore();
  procedures = createFakeRoundProcedures();
  fakeWindow = createFakeRoundWindow();
  fakeWindow.setLocal({ inProgress: [] });
});

describe("RoundsHome", () => {
  describe("入力中のラウンドの表示", () => {
    it("端末の入力中のラウンドを実施日の新しい順にカードで表示し、新規作成ボタンも表示する", () => {
      // Given
      fakeWindow.setLocal({ inProgress });

      // When
      renderHome();

      // Then
      const cards = screen.getAllByRole("listitem");
      expect(cards).toHaveLength(2);
      expect(cards[0]).toHaveTextContent("午後練習");
      expect(cards[1]).toHaveTextContent("午前練習");
      expect(screen.getByText("2026-09-15")).toBeInTheDocument();
      expect(
        screen.getByText(roundsText("roundTotalPoints", { total: "300" })),
      ).toBeInTheDocument();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
    });

    it("見出しと件数の表示を持たない", () => {
      // Given
      fakeWindow.setLocal({ inProgress });

      // When
      renderHome();

      // Then
      expect(screen.queryByRole("heading")).toBeNull();
    });

    it("履歴の取得を呼ばず、取得が応答しない状況でも入力中のラウンドを表示する", () => {
      // Given
      fakeWindow.setLocal({ inProgress });
      fake.store.loadList.mockReturnValue(new Promise(() => {}));

      // When
      renderHome();

      // Then
      expect(screen.getByText("午前練習")).toBeInTheDocument();
      expect(fake.store.loadList).not.toHaveBeenCalled();
      expect(fake.store.readDeleted).not.toHaveBeenCalled();
    });

    it("履歴の取得が失敗する設定でも、入力中のラウンドを表示する", () => {
      // Given
      fakeWindow.setLocal({ inProgress });
      fake.store.loadList.mockResolvedValue({
        status: "error",
        reason: "failed",
      });

      // When
      renderHome();

      // Then
      expect(screen.getByText("午前練習")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("入力中が0件なら、入力中のラウンドがないことを示し、新規作成ボタンは表示する", () => {
      // Given
      fakeWindow.setLocal({ inProgress: [] });

      // When
      renderHome();

      // Then
      expect(screen.getByText(roundsText("homeEmpty"))).toBeInTheDocument();
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
    });

    it("端末の入力中をまだ読んでいなければ、カードも空の表示も出さず、新規作成ボタンは表示する", () => {
      // Given
      fakeWindow.roundWindow.localList.mockReturnValue(null);

      // When
      renderHome();

      // Then
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(screen.queryByText(roundsText("homeEmpty"))).toBeNull();
      expect(screen.getByTestId("new-round-fab")).toBeInTheDocument();
    });
  });

  describe("ラウンドの削除", () => {
    it("確認すると、そのラウンドを削除し、ダイアログがすぐ閉じ、カードから取り除く", async () => {
      // Given
      // 削除の保存は終わらない。
      procedures.deletion.deleteRound.mockReturnValue(new Promise(() => {}));
      fakeWindow.setLocal({ inProgress });
      const user = userEvent.setup();
      renderHome();
      await openDeleteDialog(user, "午前練習");
      expect(
        screen.getByText(
          roundsText("roundDeleteConfirmNamed", { name: "午前練習" }),
        ),
      ).toBeInTheDocument();

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(procedures.deletion.deleteRound).toHaveBeenCalledExactlyOnceWith(
        "round-1",
      );
      await waitFor(() => {
        expect(screen.queryByText("午前練習")).not.toBeInTheDocument();
      });
      expect(screen.getByText("午後練習")).toBeInTheDocument();
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
    });

    it("最後の1件を削除すると、入力中のラウンドがないことを示す", async () => {
      // Given
      fakeWindow.setLocal({ inProgress: [inProgress[0]] });
      const user = userEvent.setup();
      renderHome();
      await openDeleteDialog(user, "午前練習");

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(
        await screen.findByText(roundsText("homeEmpty")),
      ).toBeInTheDocument();
    });

    it("名前の有るラウンドのメニューボタンは名前を引用し、名前の無いラウンドのメニューボタンは「ラウンドのメニュー」にする", () => {
      // Given
      fakeWindow.setLocal({
        inProgress: [
          inProgress[0],
          { id: "round-9", name: "", roundDate: "2026-09-17", total: 100 },
        ],
      });

      // When
      renderHome();

      // Then
      expect(
        screen.getByRole("button", {
          name: roundsText("roundMenuLabelNamed", { name: "午前練習" }),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: roundsText("roundMenuLabel") }),
      ).toBeInTheDocument();
    });

    it("名前の無いラウンドの削除確認は、名前を引用しない", async () => {
      // Given
      fakeWindow.setLocal({
        inProgress: [
          { id: "round-9", name: "", roundDate: "2026-09-17", total: 100 },
        ],
      });
      const user = userEvent.setup();
      renderHome();

      // When
      await openDeleteDialog(user, "2026-09-17");

      // Then
      expect(
        screen.getByText(roundsText("roundDeleteConfirm")),
      ).toBeInTheDocument();
    });

    it("キャンセルすると削除確認を閉じ、削除せず、カードに残す", async () => {
      // Given
      fakeWindow.setLocal({ inProgress });
      const user = userEvent.setup();
      renderHome();
      await openDeleteDialog(user, "午前練習");

      // When
      await user.click(screen.getByTestId("confirm-dialog-cancel"));

      // Then
      await waitFor(() => {
        expect(screen.queryByTestId("confirm-dialog-cancel")).toBeNull();
      });
      expect(procedures.deletion.deleteRound).not.toHaveBeenCalled();
      expect(screen.getByText("午前練習")).toBeInTheDocument();
    });
  });
});

import {
  render as renderWithoutStore,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeRoundDetailStore } from "@/features/rounds/ui/round-stores-test-helpers";
import { RoundDetailStoreProvider } from "@/features/rounds/ui/rounds-context";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { RoundMenu } from "./round-menu";

const roundsText = translatorFor("rounds");

// 削除して離れる手続きは境界として偽の約束(ラウンドの状態と変更の方法)のdeleteRoundAndLeaveで受ける。遷移の順序は手続きのテストが確かめる。
let fake: ReturnType<typeof createFakeRoundDetailStore>;

function render(ui: ReactElement) {
  return renderWithoutStore(
    <IntlTestProvider>
      <RoundDetailStoreProvider store={fake.store}>
        {ui}
      </RoundDetailStoreProvider>
    </IntlTestProvider>,
  );
}

async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("round-menu-trigger"));
  await user.click(await screen.findByTestId("round-delete"));
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeRoundDetailStore();
});

describe("RoundMenu", () => {
  describe("ラウンドの削除", () => {
    it("削除を選ぶと、ラウンドの名前を引用せず、記録したスコアがすべて失われることを示す確認ダイアログを開く", async () => {
      // Given
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await user.click(screen.getByTestId("round-menu-trigger"));

      // When
      await user.click(await screen.findByTestId("round-delete"));

      // Then
      expect(
        screen.getByText(roundsText("roundDeleteConfirm")),
      ).toBeInTheDocument();
    });

    it("確認すると、ダイアログを閉じ、そのラウンドの削除して離れる手続きを呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(fake.store.deleteRoundAndLeave).toHaveBeenCalledExactlyOnceWith(
        "round-1",
      );
      await waitFor(() => {
        expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
      });
    });

    it("削除して離れる手続きが終わるまでの間も、ダイアログはすぐ閉じる", async () => {
      // Given
      const leaving = Promise.withResolvers<void>();
      fake.store.deleteRoundAndLeave.mockReturnValue(leaving.promise);
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
      leaving.resolve();
    });
  });
});

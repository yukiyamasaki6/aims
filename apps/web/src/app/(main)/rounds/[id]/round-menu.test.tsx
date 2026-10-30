import {
  render as renderWithoutStore,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoundsStoreProvider } from "@/features/rounds/ui/rounds-context";
import { createFakeRoundsStore } from "@/features/rounds/ui/rounds-store-test-helpers";
import { RoundMenu } from "./round-menu";

// 削除は境界として偽の約束(ラウンドの状態と変更の方法)のdeleteRoundで受ける。
let fake: ReturnType<typeof createFakeRoundsStore>;

function render(ui: ReactElement) {
  return renderWithoutStore(
    <RoundsStoreProvider store={fake.store}>{ui}</RoundsStoreProvider>,
  );
}

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("round-menu-trigger"));
  await user.click(await screen.findByTestId("round-delete"));
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeRoundsStore();
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
        screen.getByText(
          "このラウンドを削除しますか？記録したスコアもすべて失われます。",
        ),
      ).toBeInTheDocument();
    });

    it("確認すると、そのラウンドを削除し、ダイアログを閉じ、一覧へ置き換えて遷移する", async () => {
      // Given
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(fake.store.deleteRound).toHaveBeenCalledExactlyOnceWith("round-1");
      await waitFor(() => {
        expect(nav.replace).toHaveBeenCalledWith("/rounds");
      });
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
    });

    it("削除の保存が終わるまでは遷移しないが、ダイアログはすぐ閉じ、終わると一覧へ置き換える", async () => {
      // Given
      const saving = Promise.withResolvers<void>();
      fake.store.deleteRound.mockReturnValue(saving.promise);
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));
      const replacedBeforeSave = nav.replace.mock.calls.length;
      saving.resolve();

      // Then
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
      expect(replacedBeforeSave).toBe(0);
      await waitFor(() => {
        expect(nav.replace).toHaveBeenCalledExactlyOnceWith("/rounds");
      });
    });
  });
});

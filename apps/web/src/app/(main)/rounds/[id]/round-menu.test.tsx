import {
  render as renderWithoutStore,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoundsStore } from "@/features/rounds/application/rounds-store";
import { RoundsStoreProvider } from "@/features/rounds/ui/rounds-context";
import { RoundMenu } from "./round-menu";

// 削除は境界としてモックするため、ラウンドの状態と変更の方法は中身を使わない偽の約束で渡す。
const store = {} as RoundsStore;

function render(ui: ReactElement) {
  return renderWithoutStore(
    <RoundsStoreProvider store={store}>{ui}</RoundsStoreProvider>,
  );
}

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

// 削除は列への入り口の先で行うため、deleteRoundを境界としてモックする。
const deletion = vi.hoisted(() => ({ deleteRound: vi.fn() }));
vi.mock("../_shared/delete-round", () => deletion);

async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("round-menu-trigger"));
  await user.click(await screen.findByTestId("round-delete"));
}

beforeEach(() => {
  vi.clearAllMocks();
  deletion.deleteRound.mockResolvedValue(undefined);
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
      expect(deletion.deleteRound).toHaveBeenCalledWith(store, "round-1");
      await waitFor(() => {
        expect(nav.replace).toHaveBeenCalledWith("/rounds");
      });
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
    });

    it("削除の保存が終わるまでは遷移しないが、ダイアログはすぐ閉じる", async () => {
      // Given
      // 保存が終わる前の状態を確かめるため、削除の保存を終わらせない。
      deletion.deleteRound.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);

      // When
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
      expect(nav.replace).not.toHaveBeenCalled();
    });
  });
});

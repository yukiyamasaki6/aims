import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoundMenu } from "./round-menu";

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
    it("確認すると、そのラウンドを削除し、ダイアログを閉じ、一覧へ置き換えて遷移する", async () => {
      // Given: 削除確認を開いている
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);
      expect(
        screen.getByText(
          "このラウンドを削除しますか？記録したスコアもすべて失われます。",
        ),
      ).toBeInTheDocument();

      // When: 削除を確認する
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then: そのラウンドを削除し、ダイアログが閉じ、一覧へ置き換えて遷移する
      expect(deletion.deleteRound).toHaveBeenCalledWith("round-1");
      await waitFor(() => {
        expect(nav.replace).toHaveBeenCalledWith("/rounds");
      });
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
    });

    it("削除の保存が終わるまでは遷移しないが、ダイアログはすぐ閉じる", async () => {
      // Given: 保存が終わらない削除
      let finish: () => void = () => {};
      deletion.deleteRound.mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const user = userEvent.setup();
      render(<RoundMenu roundId="round-1" />);
      await openDeleteConfirm(user);

      // When: 削除を確認する
      await user.click(screen.getByTestId("confirm-dialog-confirm"));

      // Then: ダイアログは閉じ、遷移はまだしない。保存が終わると遷移する
      expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
      expect(nav.replace).not.toHaveBeenCalled();
      finish();
      await waitFor(() => {
        expect(nav.replace).toHaveBeenCalledWith("/rounds");
      });
    });
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoundConfig } from "./round-config";
import { RoundConfigPanel } from "./round-config-panel";

const initial: RoundConfig = {
  name: "午前練習",
  roundDate: "2026-09-15",
  format: "outdoor",
  bowType: "recurve",
};

function setup(
  overrides: Partial<Parameters<typeof RoundConfigPanel>[0]> = {},
) {
  const onSaved = vi.fn();
  const enqueue = vi.fn();
  const utils = render(
    <RoundConfigPanel
      roundId="round-1"
      initial={initial}
      onSaved={onSaved}
      hasUnmarkedDistances={false}
      enqueue={enqueue}
      {...overrides}
    />,
  );
  return { onSaved, enqueue, ...utils };
}

describe("RoundConfigPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("初期表示", () => {
    it("折りたたまれており、保存済みの値を要約表示する", () => {
      // Given: 保存済みの値（initial）
      // When: パネルを表示する
      setup();

      // Then: 要約だけが表示され、編集欄は表示されない
      expect(
        screen.getByText("午前練習 / 2026-09-15 / アウトドア / リカーブ"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
    });
  });

  describe("要約のクリック", () => {
    it("展開し、再度クリックすると閉じる", async () => {
      // Given: 折りたたまれたパネル
      const user = userEvent.setup();
      setup();

      // When: 要約をクリックする
      await user.click(screen.getByTestId("round-config-summary"));

      // Then: 編集欄が表示される
      expect(screen.getByTestId("round-config-name")).toBeInTheDocument();

      // When: 再度クリックする
      await user.click(screen.getByTestId("round-config-summary"));

      // Then: 編集欄が閉じる
      expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
    });

    it("保存せず閉じて再展開すると、未保存の編集は破棄され保存済みの値に戻る", async () => {
      // Given: 展開してラウンド名を編集し、保存せず閉じたパネル
      const user = userEvent.setup();
      setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-name"));
      await user.type(screen.getByTestId("round-config-name"), "未保存の編集");
      await user.click(screen.getByTestId("round-config-summary"));

      // When: 再展開する
      await user.click(screen.getByTestId("round-config-summary"));

      // Then: 保存済みの値に戻っている
      expect(screen.getByTestId("round-config-name")).toHaveValue("午前練習");
    });
  });

  describe("保存", () => {
    describe("入力内容が有効な場合", () => {
      it("onSavedとenqueueを検証済みの設定で呼び、折りたたんで要約を更新する", async () => {
        // Given: ラウンド名と弓種を編集したパネル
        vi.spyOn(crypto, "randomUUID").mockReturnValue(
          "00000000-0000-4000-8000-000000000001",
        );
        const user = userEvent.setup();
        const { onSaved, enqueue } = setup();
        await user.click(screen.getByTestId("round-config-summary"));
        await user.clear(screen.getByTestId("round-config-name"));
        await user.type(screen.getByTestId("round-config-name"), "午後練習");
        await user.click(screen.getByTestId("round-config-bow-type-compound"));

        // When: 保存する
        await user.click(screen.getByTestId("round-config-save"));

        // Then: 設定を通知し、round.updatedの操作を登録して折りたたむ
        expect(onSaved).toHaveBeenCalledWith({
          name: "午後練習",
          roundDate: "2026-09-15",
          format: "outdoor",
          bowType: "compound",
        });
        expect(enqueue).toHaveBeenCalledWith({
          key: "roundConfig",
          label: "ラウンド設定",
          operation: {
            type: "round.updated",
            eventId: "00000000-0000-4000-8000-000000000001",
            roundId: "round-1",
            name: "午後練習",
            roundDate: "2026-09-15",
            format: "outdoor",
            bowType: "compound",
          },
        });
        expect(
          screen.queryByTestId("round-config-name"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByText("午後練習 / 2026-09-15 / アウトドア / コンパウンド"),
        ).toBeInTheDocument();
      });
    });

    describe("入力内容が無効な場合", () => {
      it("各項目のエラーを表示し、onSavedもenqueueも呼ばない", async () => {
        // Given: Unmarkedの距離が残っている状態で、ラウンド名・実施日・種別をいずれも無効にしたパネル
        const user = userEvent.setup();
        const { onSaved, enqueue } = setup({ hasUnmarkedDistances: true });
        await user.click(screen.getByTestId("round-config-summary"));
        await user.clear(screen.getByTestId("round-config-name"));
        await user.type(
          screen.getByTestId("round-config-name"),
          "あ".repeat(51),
        );
        await user.clear(screen.getByTestId("round-config-date"));
        await user.click(screen.getByTestId("round-config-format-indoor"));

        // When: 保存する
        await user.click(screen.getByTestId("round-config-save"));

        // Then: 各項目のエラーを表示し、保存も同期操作の登録もしない
        expect(
          screen.getByText("ラウンド名は50文字以内で入力してください。"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("実施日を入力してください。"),
        ).toBeInTheDocument();
        expect(
          screen.getByText(
            "Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。",
          ),
        ).toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      });
    });
  });

  describe("Escapeキー", () => {
    it("保存せずに閉じる", async () => {
      // Given: 展開したパネル
      const user = userEvent.setup();
      const { onSaved, enqueue } = setup();
      await user.click(screen.getByTestId("round-config-summary"));

      // When: Escapeキーを押す
      await user.keyboard("{Escape}");

      // Then: 閉じるだけで、保存も同期操作の登録もしない
      expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe("initialの更新", () => {
    it("保存済みの値が追従する", () => {
      // Given: 表示中のパネル
      const { rerender } = setup();

      // When: 外部からinitialを更新する
      rerender(
        <RoundConfigPanel
          roundId="round-1"
          initial={{ ...initial, name: "更新後" }}
          onSaved={vi.fn()}
          hasUnmarkedDistances={false}
          enqueue={vi.fn()}
        />,
      );

      // Then: 要約が更新後の値になる
      expect(
        screen.getByText("更新後 / 2026-09-15 / アウトドア / リカーブ"),
      ).toBeInTheDocument();
    });
  });
});

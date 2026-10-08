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

function panel(config: RoundConfig, enqueue = vi.fn()) {
  return (
    <RoundConfigPanel
      roundId="round-1"
      initial={config}
      hasUnmarkedDistances={false}
      enqueue={enqueue}
    />
  );
}

function setup(
  overrides: Partial<Parameters<typeof RoundConfigPanel>[0]> = {},
) {
  const enqueue = vi.fn();
  const utils = render(
    <RoundConfigPanel
      roundId="round-1"
      initial={initial}
      hasUnmarkedDistances={false}
      enqueue={enqueue}
      {...overrides}
    />,
  );
  return { enqueue, ...utils };
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

  describe("ラウンド名が空の場合", () => {
    it("名前の区切りを表示せず、実施日・種別・弓種だけを要約表示する", () => {
      // Given: ラウンド名が空の保存済みの値
      // When: パネルを表示する
      setup({ initial: { ...initial, name: "" } });

      // Then: 先頭に区切りを付けず、実施日・種別・弓種を表示する
      expect(screen.getByTestId("round-config-summary")).toHaveTextContent(
        /^2026-09-15 \/ アウトドア \/ リカーブ$/,
      );
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

    it("閉じて再展開すると、未保存の編集は破棄され、その時点の値から作り直す", async () => {
      // Given: 展開してラウンド名を編集し、保存せず閉じたパネルで、閉じている間にinitialが変わった
      const user = userEvent.setup();
      const { rerender } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-name"));
      await user.type(screen.getByTestId("round-config-name"), "未保存の編集");
      await user.click(screen.getByTestId("round-config-summary"));
      rerender(panel({ ...initial, name: "他の端末の名前" }));

      // When: 再展開する
      await user.click(screen.getByTestId("round-config-summary"));

      // Then: その時点のinitialの値になっている
      expect(screen.getByTestId("round-config-name")).toHaveValue(
        "他の端末の名前",
      );
    });
  });

  describe("保存", () => {
    describe("入力内容が有効な場合", () => {
      it("enqueueを検証済みの設定で呼び、折りたたむ", async () => {
        // Given: ラウンド名と弓種を編集したパネル
        vi.spyOn(crypto, "randomUUID").mockReturnValue(
          "00000000-0000-4000-8000-000000000001",
        );
        const user = userEvent.setup();
        const { enqueue } = setup();
        await user.click(screen.getByTestId("round-config-summary"));
        await user.clear(screen.getByTestId("round-config-name"));
        await user.type(screen.getByTestId("round-config-name"), "午後練習");
        await user.click(screen.getByTestId("round-config-bow-type-compound"));

        // When: 保存する
        await user.click(screen.getByTestId("round-config-save"));

        // Then: round.updatedの操作を登録して折りたたむ
        expect(enqueue).toHaveBeenCalledWith({
          type: "round.updated",
          eventId: "00000000-0000-4000-8000-000000000001",
          roundId: "round-1",
          changes: { name: "午後練習", bowType: "compound" },
        });
        expect(
          screen.queryByTestId("round-config-name"),
        ).not.toBeInTheDocument();
      });
    });

    describe("入力内容が無効な場合", () => {
      it("各項目のエラーを表示し、enqueueを呼ばない", async () => {
        // Given: Unmarkedの距離が残っている状態で、ラウンド名・実施日・種別をいずれも無効にしたパネル
        const user = userEvent.setup();
        const { enqueue } = setup({ hasUnmarkedDistances: true });
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
        expect(enqueue).not.toHaveBeenCalled();
      });
    });
  });

  describe("Escapeキー", () => {
    it("保存せずに閉じる", async () => {
      // Given: 展開したパネル
      const user = userEvent.setup();
      const { enqueue } = setup();
      await user.click(screen.getByTestId("round-config-summary"));

      // When: Escapeキーを押す
      await user.keyboard("{Escape}");

      // Then: 閉じるだけで、保存も同期操作の登録もしない
      expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe("initialの更新", () => {
    it("閉じているときは、要約が追従する", () => {
      const { rerender } = setup();

      rerender(panel({ ...initial, name: "更新後" }));

      expect(
        screen.getByText("更新後 / 2026-09-15 / アウトドア / リカーブ"),
      ).toBeInTheDocument();
    });

    it("開いている間は、参照や内容が変わっても下書きを書き換えず、保存は開いたときの値との差だけを送る", async () => {
      // Given: 展開してラウンド名を編集している
      const user = userEvent.setup();
      const { enqueue, rerender } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-name"));
      await user.type(screen.getByTestId("round-config-name"), "編集中");

      // When: 同じ内容の別の参照、続けて他の端末で変わった内容が届く
      rerender(panel({ ...initial }, enqueue));
      rerender(panel({ ...initial, bowType: "compound" }, enqueue));

      // Then: 下書きは残り、保存はユーザーが変えた項目だけを送る
      expect(screen.getByTestId("round-config-name")).toHaveValue("編集中");
      await user.click(screen.getByTestId("round-config-save"));
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ changes: { name: "編集中" } }),
      );
    });
  });
});

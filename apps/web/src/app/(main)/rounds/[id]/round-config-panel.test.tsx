import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoundConfig } from "@/features/rounds/round-config";
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
      // Given
      // When
      setup();

      // Then
      expect(
        screen.getByText("午前練習 / 2026-09-15 / アウトドア / リカーブ"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
    });
  });

  describe("ラウンド名が空の場合", () => {
    it("名前の区切りを表示せず、実施日・種別・弓種だけを要約表示する", () => {
      // Given
      // When
      setup({ initial: { ...initial, name: "" } });

      // Then
      expect(screen.getByTestId("round-config-summary")).toHaveTextContent(
        /^2026-09-15 \/ アウトドア \/ リカーブ$/,
      );
    });
  });

  describe("要約のクリック", () => {
    it("要約を押すと、編集欄を展開する", async () => {
      // Given
      const user = userEvent.setup();
      setup();

      // When
      await user.click(screen.getByTestId("round-config-summary"));

      // Then
      expect(screen.getByTestId("round-config-name")).toBeInTheDocument();
    });

    it("展開中に要約を再度押すと、編集欄を閉じる", async () => {
      // Given
      const user = userEvent.setup();
      setup();
      await user.click(screen.getByTestId("round-config-summary"));

      // When
      await user.click(screen.getByTestId("round-config-summary"));

      // Then
      expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
    });

    it("閉じて再展開すると、未保存の編集は破棄され、その時点の値から作り直す", async () => {
      // Given
      const user = userEvent.setup();
      const { rerender } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-name"));
      await user.type(screen.getByTestId("round-config-name"), "未保存の編集");
      await user.click(screen.getByTestId("round-config-summary"));
      rerender(panel({ ...initial, name: "他の端末の名前" }));

      // When
      await user.click(screen.getByTestId("round-config-summary"));

      // Then
      expect(screen.getByTestId("round-config-name")).toHaveValue(
        "他の端末の名前",
      );
    });
  });

  describe("保存", () => {
    describe("入力内容が有効な場合", () => {
      it("enqueueを検証済みの設定で呼び、折りたたむ", async () => {
        // Given
        vi.spyOn(crypto, "randomUUID").mockReturnValue(
          "00000000-0000-4000-8000-000000000001",
        );
        const user = userEvent.setup();
        const { enqueue } = setup();
        await user.click(screen.getByTestId("round-config-summary"));
        await user.clear(screen.getByTestId("round-config-name"));
        await user.type(screen.getByTestId("round-config-name"), "午後練習");
        await user.click(screen.getByTestId("round-config-bow-type-compound"));

        // When
        await user.click(screen.getByTestId("round-config-save"));

        // Then
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
        // Given
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

        // When
        await user.click(screen.getByTestId("round-config-save"));

        // Then
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
      // Given
      const user = userEvent.setup();
      const { enqueue } = setup();
      await user.click(screen.getByTestId("round-config-summary"));

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe("背景のクリック", () => {
    it("変更中に背景を押すと、保存せずに閉じる", async () => {
      // Given
      const user = userEvent.setup();
      const { enqueue } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-name"));
      await user.type(
        screen.getByTestId("round-config-name"),
        "破棄される名前",
      );
      const backdrops = document.querySelectorAll(".bg-black\\/40");

      // When
      await user.click(backdrops[backdrops.length - 1]);

      // Then
      expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe("initialの更新", () => {
    it("閉じているときは、要約が追従する", () => {
      // Given
      const { rerender } = setup();

      // When
      rerender(panel({ ...initial, name: "更新後" }));

      // Then
      expect(
        screen.getByText("更新後 / 2026-09-15 / アウトドア / リカーブ"),
      ).toBeInTheDocument();
    });

    it("開いている間に参照や内容が変わっても、下書きを書き換えない", async () => {
      // Given
      const user = userEvent.setup();
      const { enqueue, rerender } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-name"));
      await user.type(screen.getByTestId("round-config-name"), "編集中");

      // When
      rerender(panel({ ...initial }, enqueue));
      rerender(panel({ ...initial, bowType: "compound" }, enqueue));

      // Then
      expect(screen.getByTestId("round-config-name")).toHaveValue("編集中");
    });

    it("開いている間に他の端末の変更が届いた後に保存すると、開いたときの値との差だけを送る", async () => {
      // Given
      const user = userEvent.setup();
      const { enqueue, rerender } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-name"));
      await user.type(screen.getByTestId("round-config-name"), "編集中");
      rerender(panel({ ...initial }, enqueue));
      rerender(panel({ ...initial, bowType: "compound" }, enqueue));

      // When
      await user.click(screen.getByTestId("round-config-save"));

      // Then
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ changes: { name: "編集中" } }),
      );
    });
  });

  describe("入力欄のEnterキー", () => {
    it.each([
      ["ラウンド名", "round-config-name"],
      ["実施日", "round-config-date"],
    ])(
      "%sの入力欄でEnterを押しても、保存もダイアログの閉鎖もしない",
      async (_label, testId) => {
        // Given
        const user = userEvent.setup();
        const { enqueue } = setup();
        await user.click(screen.getByTestId("round-config-summary"));
        const input = screen.getByTestId(testId);
        await user.click(input);

        // When
        await user.keyboard("{Enter}");

        // Then
        expect(screen.getByTestId("round-config-name")).toBeInTheDocument();
        expect(enqueue).not.toHaveBeenCalled();
      },
    );
  });
});

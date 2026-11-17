import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoundConfig } from "@/features/rounds/domain/round-config";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { RoundConfigPanel } from "./round-config-panel";
import { createFakeRoundProcedures } from "./round-stores-test-helpers";
import { RoundProceduresProvider } from "./rounds-context";

const roundsText = translatorFor("rounds");

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
      defaultExpanded={false}
      hasUnmarkedDistances={false}
      enqueue={enqueue}
    />
  );
}

function setup(
  overrides: Partial<Parameters<typeof RoundConfigPanel>[0]> = {},
) {
  const enqueue = vi.fn();
  const procedures = createFakeRoundProcedures();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <IntlTestProvider>
      <RoundProceduresProvider procedures={procedures}>
        {children}
      </RoundProceduresProvider>
    </IntlTestProvider>
  );
  const utils = render(
    <RoundConfigPanel
      roundId="round-1"
      initial={initial}
      defaultExpanded={false}
      hasUnmarkedDistances={false}
      enqueue={enqueue}
      {...overrides}
    />,
    { wrapper },
  );
  return { enqueue, procedures, ...utils };
}

// 種別・弓種のドロップダウンを開いて、選択肢を選ぶ。
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  optionName: string,
) {
  await user.click(screen.getByTestId(testId));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

describe("RoundConfigPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("初期表示", () => {
    it("折りたたまれており、実施日・種別・弓種だけを「 / 」で並べて要約表示し、名前を含めない", () => {
      // Given
      // When
      setup();

      // Then
      const summary = screen.getByTestId("round-config-summary");
      expect(summary).toHaveTextContent(
        /^2026-09-15 \/ アウトドア \/ リカーブ$/,
      );
      expect(summary).not.toHaveTextContent("午前練習");
      expect(screen.queryByTestId("round-config-date")).not.toBeInTheDocument();
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
      expect(screen.getByTestId("round-config-date")).toBeInTheDocument();
    });

    it("展開すると、名前の入力欄はなく、実施日の入力欄と、名前「種別」「弓種」のドロップダウンがある", async () => {
      // Given
      const user = userEvent.setup();
      setup();

      // When
      await user.click(screen.getByTestId("round-config-summary"));

      // Then
      expect(screen.queryByLabelText(roundsText("roundConfigName"))).toBeNull();
      expect(screen.getByTestId("round-config-date")).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", {
          name: new RegExp(roundsText("roundConfigFormat")),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", {
          name: new RegExp(roundsText("roundConfigBowType")),
        }),
      ).toBeInTheDocument();
    });

    it.each([
      ["種別", "round-config-format", ["アウトドア", "インドア", "フィールド"]],
      [
        "弓種",
        "round-config-bow-type",
        ["リカーブ", "コンパウンド", "ベアボウ"],
      ],
    ])(
      "%sは選択肢から1つ選び、選択肢は%sの3つだけで「指定なし」がない",
      async (_name, testId, expected) => {
        // Given
        const user = userEvent.setup();
        setup();
        await user.click(screen.getByTestId("round-config-summary"));

        // When
        await user.click(screen.getByTestId(testId));

        // Then
        const names = (await screen.findAllByRole("option")).map(
          (option) => option.textContent,
        );
        expect(names).toEqual(expected);
        expect(names).not.toContain(roundsText("historyFilterNone"));
      },
    );

    it("展開中に要約を再度押すと、編集欄を閉じる", async () => {
      // Given
      const user = userEvent.setup();
      setup();
      await user.click(screen.getByTestId("round-config-summary"));

      // When
      await user.click(screen.getByTestId("round-config-summary"));

      // Then
      expect(screen.queryByTestId("round-config-date")).not.toBeInTheDocument();
    });

    it("閉じて再展開すると、未保存の編集は破棄され、その時点の値から作り直す", async () => {
      // Given
      const user = userEvent.setup();
      const { rerender } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-date"));
      await user.type(screen.getByTestId("round-config-date"), "2026-12-31");
      await user.click(screen.getByTestId("round-config-summary"));
      rerender(panel({ ...initial, roundDate: "2026-10-01" }));

      // When
      await user.click(screen.getByTestId("round-config-summary"));

      // Then
      expect(screen.getByTestId("round-config-date")).toHaveValue("2026-10-01");
    });
  });

  describe("閉じるボタン", () => {
    it("設定を開くと、閉じるボタンの文言は確定になる", async () => {
      // Given
      const user = userEvent.setup();
      setup();

      // When
      await user.click(screen.getByTestId("round-config-summary"));

      // Then
      expect(screen.getByTestId("round-config-save")).toHaveTextContent(
        roundsText("confirm"),
      );
    });
  });

  describe("保存", () => {
    describe("入力内容が有効な場合", () => {
      it("種別と弓種を選び直して保存すると、その2項目だけを変える操作を積み、折りたたむ", async () => {
        // Given
        const user = userEvent.setup();
        const { enqueue, procedures } = setup();
        procedures.ids.next.mockReturnValue(
          "00000000-0000-4000-8000-000000000001",
        );
        await user.click(screen.getByTestId("round-config-summary"));
        await choose(user, "round-config-format", "インドア");
        await choose(user, "round-config-bow-type", "コンパウンド");

        // When
        await user.click(screen.getByTestId("round-config-save"));

        // Then
        expect(enqueue).toHaveBeenCalledWith({
          type: "round.updated",
          eventId: "00000000-0000-4000-8000-000000000001",
          roundId: "round-1",
          changes: { format: "indoor", bowType: "compound" },
        });
        expect(
          screen.queryByTestId("round-config-date"),
        ).not.toBeInTheDocument();
      });
    });

    describe("何も変えない場合", () => {
      it("保存しても操作を積まず、閉じる", async () => {
        // Given
        const user = userEvent.setup();
        const { enqueue } = setup();
        await user.click(screen.getByTestId("round-config-summary"));

        // When
        await user.click(screen.getByTestId("round-config-save"));

        // Then
        expect(enqueue).not.toHaveBeenCalled();
        expect(
          screen.queryByTestId("round-config-date"),
        ).not.toBeInTheDocument();
      });
    });

    describe("入力内容が無効な場合", () => {
      it("各項目のエラーを表示し、enqueueを呼ばない", async () => {
        // Given
        const user = userEvent.setup();
        const { enqueue } = setup({ hasUnmarkedDistances: true });
        await user.click(screen.getByTestId("round-config-summary"));
        await user.clear(screen.getByTestId("round-config-date"));
        await choose(user, "round-config-format", "インドア");

        // When
        await user.click(screen.getByTestId("round-config-save"));

        // Then
        expect(
          screen.getByText(roundsText("roundConfigError.required")),
        ).toBeInTheDocument();
        expect(
          screen.getByText(roundsText("roundConfigError.unmarkedDistances")),
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
      expect(screen.queryByTestId("round-config-date")).not.toBeInTheDocument();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe("背景のクリック", () => {
    it("変更中に背景を押すと、保存せずに閉じる", async () => {
      // Given
      const user = userEvent.setup();
      const { enqueue } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await choose(user, "round-config-bow-type", "コンパウンド");
      const backdrops = document.querySelectorAll(".bg-black\\/40");

      // When
      await user.click(backdrops[backdrops.length - 1]);

      // Then
      expect(screen.queryByTestId("round-config-date")).not.toBeInTheDocument();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe("initialの更新", () => {
    it("閉じているときは、要約が追従する", () => {
      // Given
      const { rerender } = setup();

      // When
      rerender(panel({ ...initial, roundDate: "2026-10-01" }));

      // Then
      expect(screen.getByTestId("round-config-summary")).toHaveTextContent(
        /^2026-10-01 \/ アウトドア \/ リカーブ$/,
      );
    });

    it("開いている間に参照や内容が変わっても、下書きを書き換えない", async () => {
      // Given
      const user = userEvent.setup();
      const { enqueue, rerender } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-date"));
      await user.type(screen.getByTestId("round-config-date"), "2026-12-31");

      // When
      rerender(panel({ ...initial }, enqueue));
      rerender(panel({ ...initial, bowType: "compound" }, enqueue));

      // Then
      expect(screen.getByTestId("round-config-date")).toHaveValue("2026-12-31");
    });

    it("開いている間に他の端末の変更が届いた後に保存すると、開いたときの値との差だけを送る", async () => {
      // Given
      const user = userEvent.setup();
      const { enqueue, rerender } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.clear(screen.getByTestId("round-config-date"));
      await user.type(screen.getByTestId("round-config-date"), "2026-12-31");
      rerender(panel({ ...initial }, enqueue));
      rerender(panel({ ...initial, bowType: "compound" }, enqueue));

      // When
      await user.click(screen.getByTestId("round-config-save"));

      // Then
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ changes: { roundDate: "2026-12-31" } }),
      );
    });
  });

  describe("入力欄のEnterキー", () => {
    it("実施日の入力欄でEnterを押しても、保存もダイアログの閉鎖もしない", async () => {
      // Given
      const user = userEvent.setup();
      const { enqueue } = setup();
      await user.click(screen.getByTestId("round-config-summary"));
      await user.click(screen.getByTestId("round-config-date"));

      // When
      await user.keyboard("{Enter}");

      // Then
      expect(screen.getByTestId("round-config-date")).toBeInTheDocument();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });
});

describe("RoundConfigPanel 初期フォーカス", () => {
  it("開くと実施日の入力欄でなく、Triggerなしのダイアログがフォーカスを持つ", async () => {
    // Given
    const user = userEvent.setup();
    setup();

    // When
    await user.click(screen.getByTestId("round-config-summary"));

    // Then
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(screen.getByTestId("round-config-date")).not.toHaveFocus();
  });
});

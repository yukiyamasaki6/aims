import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RoundConfig } from "@/features/rounds/domain/round-config";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { SyncOperation } from "../domain/sync-events";
import { RoundNameEditor } from "./round-name-editor";
import { createFakeRoundProcedures } from "./round-stores-test-helpers";
import { RoundProceduresProvider } from "./rounds-context";

const roundsText = translatorFor("rounds");

const initial: RoundConfig = {
  name: "午前練習",
  roundDate: "2026-09-15",
  format: "outdoor",
  bowType: "recurve",
};

const display = () => screen.getByTestId("round-name-display");
const input = () => screen.getByTestId("round-name-input") as HTMLInputElement;

// 親の役割。積まれた操作の名前を設定に反映し、外の更新(実施日)も与えられるようにする。
let setConfigFromOutside: (patch: Partial<RoundConfig>) => void;
function setup(config: RoundConfig = initial) {
  const enqueue = vi.fn<(operation: SyncOperation) => void>();
  const procedures = createFakeRoundProcedures();
  procedures.ids.next.mockReturnValue("00000000-0000-4000-8000-000000000001");
  function Parent({ children }: { children: ReactNode }) {
    return (
      <IntlTestProvider>
        <RoundProceduresProvider procedures={procedures}>
          {children}
        </RoundProceduresProvider>
      </IntlTestProvider>
    );
  }
  function Harness() {
    const [current, setCurrent] = useState(config);
    setConfigFromOutside = (patch) =>
      setCurrent((previous) => ({ ...previous, ...patch }));
    return (
      <RoundNameEditor
        roundId="round-1"
        config={current}
        enqueue={(operation) => {
          enqueue(operation);
          if (
            operation.type === "round.updated" &&
            operation.changes.name !== undefined
          ) {
            setCurrent((previous) => ({
              ...previous,
              name: operation.changes.name as string,
            }));
          }
        }}
      />
    );
  }
  render(<Harness />, { wrapper: Parent });
  return { enqueue, user: userEvent.setup() };
}

describe("RoundNameEditor", () => {
  describe("表示", () => {
    it("名前のボタンの名前は「ラウンド名を編集: <名前>」である", () => {
      // Given
      // When
      setup();

      // Then
      expect(
        screen.getByRole("button", {
          name: roundsText("roundNameEditNamed", { name: "午前練習" }),
        }),
      ).toBe(display());
    });

    it("名前が空のときは、見える文字がプレースホルダー「ラウンド名」で、ボタンの名前が「ラウンド名を編集」で始まり、押すと入力欄になる", async () => {
      // Given
      const { user } = setup({ ...initial, name: "" });

      // When
      // 文言そのもの(設計の「ラウンド名を編集で始まる」)を確かめるため、文字列を書く。
      const button = screen.getByRole("button", { name: /^ラウンド名を編集/ });
      expect(button).toHaveTextContent(roundsText("roundNamePlaceholder"));
      expect(button).toHaveAccessibleName(
        expect.stringContaining(roundsText("roundNamePlaceholder")),
      );
      await user.click(button);

      // Then
      expect(button).not.toBeInTheDocument();
      expect(input()).toHaveValue("");
      expect(input()).toHaveAttribute(
        "placeholder",
        roundsText("roundNamePlaceholder"),
      );
    });

    it("名前を押すと、現在の名前を値に持つ入力欄(名前「ラウンド名」)にフォーカスが入り、表示のボタンはなくなる", async () => {
      // Given
      const { user } = setup();

      // When
      await user.click(display());

      // Then
      expect(
        screen.getByRole("textbox", { name: roundsText("roundConfigName") }),
      ).toBe(input());
      expect(input()).toHaveValue("午前練習");
      expect(input()).toHaveFocus();
      expect(screen.queryByTestId("round-name-display")).toBeNull();
    });
  });

  describe("編集に入ったとき", () => {
    it("名前があるときは、入力欄の文字が全て選択された状態になる", async () => {
      // Given
      const { user } = setup();

      // When
      await user.click(display());

      // Then
      expect(input().selectionStart).toBe(0);
      expect(input().selectionEnd).toBe("午前練習".length);
    });

    it("名前が空のときは、全選択の影響がなく、入力欄は空のままで、カーソルは先頭にある", async () => {
      // Given
      const { user } = setup({ ...initial, name: "" });

      // When
      await user.click(display());

      // Then
      expect(input()).toHaveValue("");
      expect(input().selectionStart).toBe(0);
      expect(input().selectionEnd).toBe(0);
    });

    it("全選択された状態で文字を入力すると、名前が置き換わり、確定すると新しい名前だけの操作を積む", async () => {
      // Given
      const { user, enqueue } = setup();
      await user.click(display());

      // When
      await user.keyboard("午後");
      await user.keyboard("{Enter}");

      // Then
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ changes: { name: "午後" } }),
      );
    });
  });

  describe("確定", () => {
    it("Enterで確定すると、名前だけを変える操作を1件積み、新しい名前の表示に戻り、フォーカスが名前のボタンへ移る", async () => {
      // Given
      const { user, enqueue } = setup();
      await user.click(display());
      await user.clear(input());
      await user.type(input(), "午後練習");

      // When
      await user.keyboard("{Enter}");

      // Then
      expect(enqueue).toHaveBeenCalledExactlyOnceWith({
        type: "round.updated",
        eventId: "00000000-0000-4000-8000-000000000001",
        roundId: "round-1",
        changes: { name: "午後練習" },
      });
      expect(display()).toHaveTextContent("午後練習");
      expect(display()).toHaveFocus();
    });

    it("入力欄の外へフォーカスを移すと確定し、操作を1件積み、フォーカスは移した先に残る", async () => {
      // Given
      const { user, enqueue } = setup();
      await user.click(display());
      await user.clear(input());
      await user.type(input(), "午後練習");
      const other = document.createElement("button");
      document.body.append(other);

      // When
      act(() => other.focus());

      // Then
      expect(enqueue).toHaveBeenCalledOnce();
      expect(display()).toHaveTextContent("午後練習");
      expect(other).toHaveFocus();
      other.remove();
    });

    it("変えていない名前は、Enterで確定しても操作を積まず、表示に戻る", async () => {
      // Given
      const { user, enqueue } = setup();
      await user.click(display());

      // When
      await user.keyboard("{Enter}");

      // Then
      expect(enqueue).not.toHaveBeenCalled();
      expect(display()).toHaveTextContent("午前練習");
    });

    it("入力欄は50文字までで、キー入力でも貼り付けでも51文字目以降を入力できず、50文字の名前をそのまま確定できる", async () => {
      // Given
      const { user, enqueue } = setup();
      await user.click(display());
      await user.clear(input());

      // When
      await user.type(input(), "あ".repeat(60));
      const typed = input().value.length;
      await user.clear(input());
      await user.click(input());
      await user.paste("い".repeat(60));
      const pasted = input().value;
      await user.keyboard("{Enter}");

      // Then
      expect(typed).toBe(50);
      expect(pasted).toBe("い".repeat(50));
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ changes: { name: "い".repeat(50) } }),
      );
    });

    it("変換中のEnterでは確定せず、入力欄のままで、操作を積まない", async () => {
      // Given
      const { user, enqueue } = setup();
      await user.click(display());
      await user.clear(input());
      await user.type(input(), "午後");

      // When
      fireEvent.keyDown(input(), { key: "Enter", isComposing: true });

      // Then
      expect(input()).toBeInTheDocument();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe("取り消し", () => {
    it("Escで取り消すと、操作を積まず編集前の名前のまま、フォーカスが名前のボタンにあり、その後のblurでも確定しない", async () => {
      // Given
      const { user, enqueue } = setup();
      await user.click(display());
      await user.clear(input());
      await user.type(input(), "午後練習");

      // When
      await user.keyboard("{Escape}");
      display().blur();

      // Then
      expect(enqueue).not.toHaveBeenCalled();
      expect(display()).toHaveTextContent("午前練習");
    });

    it("Escで取り消した直後は、フォーカスが名前のボタンにある", async () => {
      // Given
      const { user } = setup();
      await user.click(display());
      await user.type(input(), "追加");

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(display()).toHaveFocus();
    });
  });

  describe("編集中の外の更新", () => {
    it("編集中に他の項目(実施日)が外から変わっても、入力の文字は書き換わらず、確定の操作は名前だけを含む", async () => {
      // Given
      const { user, enqueue } = setup();
      await user.click(display());
      await user.clear(input());
      await user.type(input(), "午後練習");

      // When
      fireEvent.focus(input());
      setConfigFromOutside({ roundDate: "2026-10-01" });
      await user.keyboard("{Enter}");

      // Then
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ changes: { name: "午後練習" } }),
      );
    });
  });
});

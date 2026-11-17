import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./select";

const COLORS = [
  { value: "none", label: "ー" },
  { value: "red", label: "赤" },
  { value: "blue", label: "青" },
];

function renderSelect(props: Partial<Parameters<typeof Select>[0]> = {}) {
  return render(
    <Select
      label="色"
      options={COLORS}
      value="red"
      onChange={() => {}}
      {...props}
    />,
  );
}

describe("Select", () => {
  describe("表示", () => {
    it("項目名を見えるラベルとして表示し、トリガーへ関連付ける", () => {
      // Given
      const label = "色";

      // When
      renderSelect({ label });

      // Then
      expect(screen.getByText("色")).toBeVisible();
      expect(screen.getByRole("combobox", { name: "色" })).toBeInTheDocument();
    });

    it("項目名に要素(必須の印つき)を渡せ、印も項目名として表示され、トリガーの名前に含まれる", () => {
      // Given
      const label = (
        <>
          色 <span>必須</span>
        </>
      );

      // When
      renderSelect({ label });

      // Then
      expect(screen.getByText("必須")).toBeVisible();
      expect(screen.getByRole("combobox", { name: /色/ })).toHaveAccessibleName(
        /必須/,
      );
    });

    it("トリガーに現在値の表示名を表示する", () => {
      // Given
      const value = "blue";

      // When
      renderSelect({ value });

      // Then
      expect(screen.getByRole("combobox")).toHaveTextContent("青");
    });

    it("未選択を表す選択肢も通常の選択肢として現在値にできる", () => {
      // Given
      const value = "none";

      // When
      renderSelect({ value });

      // Then
      expect(screen.getByRole("combobox")).toHaveTextContent("ー");
    });

    it("testId をトリガーに付ける", () => {
      // Given
      const testId = "color-select";

      // When
      renderSelect({ testId });

      // Then
      expect(screen.getByTestId("color-select")).toBe(
        screen.getByRole("combobox"),
      );
    });

    it("トリガーを押すと、渡した選択肢を全て表示する", async () => {
      // Given
      const user = userEvent.setup();
      renderSelect();

      // When
      await user.click(screen.getByRole("combobox"));

      // Then
      const options = await screen.findAllByRole("option");
      expect(options.map((o) => o.textContent)).toEqual(["ー", "赤", "青"]);
    });
  });

  describe("操作", () => {
    it("選択肢を押すと、その value で onChange を呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderSelect({ onChange });
      await user.click(screen.getByRole("combobox"));

      // When
      await user.click(await screen.findByRole("option", { name: "青" }));

      // Then
      expect(onChange).toHaveBeenCalledWith("blue");
    });

    it("未選択を表す選択肢を押すと、その value で onChange を呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderSelect({ onChange });
      await user.click(screen.getByRole("combobox"));

      // When
      await user.click(await screen.findByRole("option", { name: "ー" }));

      // Then
      expect(onChange).toHaveBeenCalledWith("none");
    });

    it("親が value を更新しない間は表示が変わらず、更新すると追従する", async () => {
      // Given
      const user = userEvent.setup();
      const { rerender } = renderSelect({ value: "red" });
      await user.click(screen.getByRole("combobox"));

      // When
      await user.click(await screen.findByRole("option", { name: "青" }));

      // Then
      expect(screen.getByRole("combobox")).toHaveTextContent("赤");

      // When
      rerender(
        <Select label="色" options={COLORS} value="blue" onChange={() => {}} />,
      );

      // Then
      expect(screen.getByRole("combobox")).toHaveTextContent("青");
    });
  });
});

describe("Select 開いている間の周りの操作", () => {
  it("選択肢を開いたまま別の入力欄を押して、入力を続けられる", async () => {
    // Given
    const user = userEvent.setup();
    render(
      <>
        <Select label="色" options={COLORS} value="red" onChange={() => {}} />
        <input aria-label="点数" />
      </>,
    );
    await user.click(screen.getByRole("combobox"));
    await screen.findAllByRole("option");
    // jsdomは周りの押下の吸収を再現しないため、modalが付けるスクロールの固定がないことで、周りを妨げないことを確かめる。
    const scrollLocked = document.body.style.overflowY === "hidden";

    // When
    const input = screen.getByRole("textbox", { name: "点数" });
    await user.click(input);
    await user.keyboard("25");

    // Then
    expect(scrollLocked).toBe(false);
    expect(input).toHaveValue("25");
  });
});

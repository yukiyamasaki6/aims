import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./switch";

describe("Switch", () => {
  it("見出しをスイッチの名前にし、状態をaria-checkedで伝える", () => {
    // Given

    // When
    render(<Switch label="距離単位で表示" checked onChange={() => {}} />);

    // Then
    expect(
      screen.getByRole("switch", { name: "距離単位で表示" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    "checked=%sのスイッチを押すと、onChangeに%sを渡す",
    async (checked, expected) => {
      // Given
      const onChange = vi.fn();
      render(
        <Switch label="距離単位で表示" checked={checked} onChange={onChange} />,
      );

      // When
      await userEvent.setup().click(screen.getByRole("switch"));

      // Then
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange.mock.calls[0][0]).toBe(expected);
    },
  );

  it("使う側が持つ値を更新すると、状態が切り替わる", async () => {
    // Given
    function Controlled() {
      const [on, setOn] = useState(false);
      return <Switch label="距離単位で表示" checked={on} onChange={setOn} />;
    }
    render(<Controlled />);

    // When
    await userEvent.setup().click(screen.getByRole("switch"));

    // Then
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const options = [
  { value: "round", label: "ラウンド" },
  { value: "distance", label: "距離" },
];

describe("SegmentedControl", () => {
  it("名前を持つグループに全ての選択肢を並べ、選択中の選択肢だけをaria-checkedで伝える", () => {
    // Given

    // When
    render(
      <SegmentedControl
        label="表示単位"
        options={options}
        value="distance"
        onChange={() => {}}
      />,
    );

    // Then
    expect(
      screen.getByRole("radiogroup", { name: "表示単位" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "距離" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "ラウンド" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("選択中でない選択肢を1回押すと、その値を変更の通知に渡す", async () => {
    // Given
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="表示単位"
        options={options}
        value="round"
        onChange={onChange}
      />,
    );

    // When
    await userEvent.setup().click(screen.getByRole("radio", { name: "距離" }));

    // Then
    expect(onChange).toHaveBeenCalledExactlyOnceWith("distance");
  });

  it("使う側が持つ値を更新すると、選択中の選択肢が切り替わる", async () => {
    // Given
    function Controlled() {
      const [value, setValue] = useState("round");
      return (
        <SegmentedControl
          label="表示単位"
          options={options}
          value={value}
          onChange={setValue}
        />
      );
    }
    render(<Controlled />);

    // When
    await userEvent.setup().click(screen.getByRole("radio", { name: "距離" }));

    // Then
    expect(screen.getByRole("radio", { name: "距離" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "ラウンド" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("testIdを渡すと、グループと各選択肢が値つきの識別子を持つ", () => {
    // Given

    // When
    render(
      <SegmentedControl
        label="表示単位"
        options={options}
        value="round"
        onChange={() => {}}
        testId="unit"
      />,
    );

    // Then
    expect(screen.getByTestId("unit")).toBeInTheDocument();
    expect(screen.getByTestId("unit-round")).toHaveTextContent("ラウンド");
    expect(screen.getByTestId("unit-distance")).toHaveTextContent("距離");
  });

  it("選択の値を切り替えても、選択の状態はaria-checkedとdata-checkedの両方で選択中の選択肢だけに付く", () => {
    // Given
    const { rerender } = render(
      <SegmentedControl
        label="表示単位"
        options={options}
        value="round"
        onChange={() => {}}
      />,
    );

    // When
    rerender(
      <SegmentedControl
        label="表示単位"
        options={options}
        value="distance"
        onChange={() => {}}
      />,
    );

    // Then
    const distance = screen.getByRole("radio", { name: "距離" });
    const round = screen.getByRole("radio", { name: "ラウンド" });
    expect(distance).toHaveAttribute("aria-checked", "true");
    expect(distance).toHaveAttribute("data-checked");
    expect(round).toHaveAttribute("aria-checked", "false");
    expect(round).not.toHaveAttribute("data-checked");
  });

  it("選択肢にない値を渡すと、どの選択肢も選択中にならず、描画も失敗しない", () => {
    // Given

    // When
    render(
      <SegmentedControl
        label="表示単位"
        options={options}
        value="none"
        onChange={() => {}}
      />,
    );

    // Then
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
  });
});

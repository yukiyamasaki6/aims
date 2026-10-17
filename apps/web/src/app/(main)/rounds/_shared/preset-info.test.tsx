import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DistanceInfo } from "./preset-info";

describe("DistanceInfo", () => {
  it("距離があり、フィールド以外の種別ではMarked/Unmarkedを表示しない", () => {
    render(
      <DistanceInfo
        distance={70}
        isMarked={false}
        format="outdoor"
        face="missing"
        arrowsPerEnd={6}
        totalEnds={6}
      />,
    );

    expect(screen.getByText("70m")).toBeInTheDocument();
  });

  it("距離がなく、フィールド以外の種別では距離部分を表示しない", () => {
    render(
      <DistanceInfo
        distance={null}
        isMarked={false}
        format="outdoor"
        face="missing"
        arrowsPerEnd={6}
        totalEnds={6}
      />,
    );

    expect(screen.queryByText(/m$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Marked")).not.toBeInTheDocument();
    expect(screen.queryByText("Unmarked")).not.toBeInTheDocument();
  });

  it("フィールド種別かつMarkedの場合、距離とMarkedを併記する", () => {
    render(
      <DistanceInfo
        distance={70}
        isMarked={true}
        format="field"
        face="missing"
        arrowsPerEnd={6}
        totalEnds={6}
      />,
    );

    expect(screen.getByText("Marked (70m)")).toBeInTheDocument();
    expect(screen.queryByText("70m / Marked")).not.toBeInTheDocument();
  });

  it("フィールド種別かつUnmarkedで距離未設定の場合、Unmarkedのみ表示する", () => {
    render(
      <DistanceInfo
        distance={null}
        isMarked={false}
        format="field"
        face="missing"
        arrowsPerEnd={6}
        totalEnds={6}
      />,
    );

    expect(screen.getByText("Unmarked")).toBeInTheDocument();
  });

  it("フィールド種別かつUnmarkedで距離（自己目測）がある場合、距離とUnmarkedを併記する", () => {
    render(
      <DistanceInfo
        distance={45}
        isMarked={false}
        format="field"
        face="missing"
        arrowsPerEnd={6}
        totalEnds={6}
      />,
    );

    expect(screen.getByText("Unmarked (45m)")).toBeInTheDocument();
    expect(screen.queryByText("45m / Unmarked")).not.toBeInTheDocument();
  });
});

describe("DistanceInfo(的の状態)", () => {
  function renderWith(face: "missing") {
    return render(
      <DistanceInfo
        distance={70}
        isMarked={false}
        format="outdoor"
        face={face}
        arrowsPerEnd={6}
        totalEnds={6}
      />,
    );
  }

  it("的が見つからないときも、距離・本数・エンド数を表示し、「的データを取得できません」を出す", () => {
    const { container } = renderWith("missing");

    expect(screen.getByText("70m")).toBeInTheDocument();
    expect(container).toHaveTextContent("6本×6エンド");
    expect(container).toHaveTextContent("的データを取得できません");
  });
});

describe("DistanceInfo(配置)", () => {
  it.each([
    {
      format: "field",
      minWidth: "min-w-[7.5rem]",
      otherWidth: "min-w-[6.5rem]",
    },
    {
      format: "outdoor",
      minWidth: "min-w-[6.5rem]",
      otherWidth: "min-w-[7.5rem]",
    },
    {
      format: "indoor",
      minWidth: "min-w-[6.5rem]",
      otherWidth: "min-w-[7.5rem]",
    },
  ])(
    "左側の最小の幅は、種別が$formatのとき$minWidthになる",
    ({ format, minWidth, otherWidth }) => {
      // Given
      // When
      render(
        <DistanceInfo
          distance={70}
          isMarked={true}
          format={format}
          face="missing"
          arrowsPerEnd={3}
          totalEnds={12}
        />,
      );

      // Then
      const left = screen.getByText("3本×12エンド").parentElement;
      expect(left).toHaveClass(minWidth);
      expect(left).not.toHaveClass(otherWidth);
    },
  );
});

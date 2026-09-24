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
        face={null}
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
        face={null}
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
        face={null}
        arrowsPerEnd={6}
        totalEnds={6}
      />,
    );

    expect(screen.getByText("70m / Marked")).toBeInTheDocument();
  });

  it("フィールド種別かつUnmarkedで距離未設定の場合、Unmarkedのみ表示する", () => {
    render(
      <DistanceInfo
        distance={null}
        isMarked={false}
        format="field"
        face={null}
        arrowsPerEnd={6}
        totalEnds={6}
      />,
    );

    expect(screen.getByText("Unmarked")).toBeInTheDocument();
  });
});

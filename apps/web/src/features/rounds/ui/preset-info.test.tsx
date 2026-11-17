import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { DistanceInfo } from "./preset-info";

const roundsText = translatorFor("rounds");

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
      { wrapper: IntlTestProvider },
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
      { wrapper: IntlTestProvider },
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
      { wrapper: IntlTestProvider },
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
      { wrapper: IntlTestProvider },
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
      { wrapper: IntlTestProvider },
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
      { wrapper: IntlTestProvider },
    );
  }

  it("的が見つからないときも、距離・射数/エンド・エンド数を表示し、「的データを取得できません」を出す", () => {
    const { container } = renderWith("missing");

    expect(screen.getByText("70m")).toBeInTheDocument();
    expect(container).toHaveTextContent(
      roundsText("distanceEnds", { arrowsPerEnd: "6", totalEnds: "6" }),
    );
    expect(container).toHaveTextContent(roundsText("targetFaceMissing"));
  });
});

describe("DistanceInfo(射数/エンド・総エンド数・的が空の要約)", () => {
  function renderWith(props: {
    arrowsPerEnd: number | null;
    totalEnds: number | null;
    face: "missing" | null;
  }) {
    return render(
      <DistanceInfo
        distance={50}
        isMarked={true}
        format="outdoor"
        {...props}
      />,
      { wrapper: IntlTestProvider },
    );
  }

  it("射数/エンドだけがあれば、距離と「N射」だけを出し、エンド数は出さない", () => {
    const { container } = renderWith({
      arrowsPerEnd: 6,
      totalEnds: null,
      face: null,
    });

    expect(screen.getByText("50m")).toBeInTheDocument();
    expect(container).toHaveTextContent(
      roundsText("distanceArrowsPerEnd", { arrowsPerEnd: "6" }),
    );
    expect(container).not.toHaveTextContent(
      roundsText("distanceEnds", { arrowsPerEnd: "6", totalEnds: "6" }),
    );
  });

  it("射数/エンドが空なら、総エンド数が空でも、距離だけを出し、射数/エンド・エンドの行を出さない", () => {
    const { container } = renderWith({
      arrowsPerEnd: null,
      totalEnds: null,
      face: null,
    });

    expect(screen.getByText("50m")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(
      roundsText("distanceArrowsPerEnd", { arrowsPerEnd: "6" }),
    );
    expect(container).not.toHaveTextContent("エンド");
  });

  it("射数/エンドと総エンド数が両方あれば、従来の「N射×Mエンド」を出す", () => {
    const { container } = renderWith({
      arrowsPerEnd: 6,
      totalEnds: 6,
      face: "missing",
    });

    expect(container).toHaveTextContent(
      roundsText("distanceEnds", { arrowsPerEnd: "6", totalEnds: "6" }),
    );
  });

  it("的が空なら「指定なし」を出し、的が見つからない表示とは区別する", () => {
    const empty = renderWith({ arrowsPerEnd: 6, totalEnds: null, face: null });
    const emptyText = empty.container.textContent;
    empty.unmount();
    const missing = renderWith({
      arrowsPerEnd: 6,
      totalEnds: null,
      face: "missing",
    });

    expect(emptyText).toContain(roundsText("historyFilterNone"));
    expect(emptyText).not.toContain(roundsText("targetFaceMissing"));
    expect(missing.container).toHaveTextContent(
      roundsText("targetFaceMissing"),
    );
    expect(missing.container).not.toHaveTextContent(
      roundsText("historyFilterNone"),
    );
  });
});

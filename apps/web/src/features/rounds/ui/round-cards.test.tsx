import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { DistanceSubtotal } from "../domain/round-list";
import { DistanceCards, RoundCards } from "./round-cards";
import {
  distanceListItem,
  roundListItem,
  WIDE_CARD_METRICS,
} from "./round-stores-test-helpers";
import { type CardMetrics, CardMetricsOverride } from "./use-card-fit";

const roundsText = translatorFor("rounds");

// 距離一覧のセル数は、日付だけの左の塊に対して、245px以上で2、289px以上で3、333px以上で4になる(card-columns.test.tsの境界と同じ値)。
const CELLS = { two: 260, three: 300, four: 340 };
const metricsOf = (available: number): CardMetrics => ({
  ...WIDE_CARD_METRICS,
  available,
});

function renderWith(metrics: CardMetrics | null, children: ReactNode) {
  render(
    <CardMetricsOverride value={metrics}>{children}</CardMetricsOverride>,
    { wrapper: IntlTestProvider },
  );
  return screen.getByRole("listitem");
}

function renderRound(
  overrides: Parameters<typeof roundListItem>[0] = {},
  metrics: CardMetrics | null = WIDE_CARD_METRICS,
) {
  return renderWith(
    metrics,
    <RoundCards
      rounds={[roundListItem(overrides)]}
      origin="history"
      onDelete={vi.fn()}
    />,
  );
}

function renderDistance(
  overrides: Parameters<typeof distanceListItem>[0] = {},
  metrics: CardMetrics | null = WIDE_CARD_METRICS,
) {
  return renderWith(
    metrics,
    <DistanceCards
      distances={[distanceListItem(overrides)]}
      origin="history"
    />,
  );
}

const metersOf = (card: HTMLElement) => card.textContent?.match(/\d+m/g) ?? [];
const marked = (distance: number, total: number): DistanceSubtotal => ({
  distance,
  isMarked: true,
  total,
});
const meters = (distance: number) =>
  roundsText("historyDistanceMarked", { distance: String(distance) });
const many = (count: number) =>
  Array.from({ length: count }, (_, i) => marked(100 - i * 10, (i + 1) * 11));

describe("RoundCards", () => {
  it("日付・ラウンド名・種別・弓種・距離ごとの距離と小計・合計点を表示し、小計は射つ順に1距離に1つ出す", () => {
    // Given
    const distances = [marked(70, 320), marked(50, 280)];

    // When
    const card = renderRound({
      name: "午前練習",
      roundDate: "2026-09-15",
      format: "outdoor",
      bowType: "compound",
      total: 600,
      distances,
    });

    // Then
    expect(card).toHaveTextContent("2026/09/15");
    expect(card).toHaveTextContent("午前練習");
    expect(card).toHaveTextContent(roundsText("formatOption.outdoor"));
    expect(card).toHaveTextContent(roundsText("bowTypeOption.compound"));
    expect(card).toHaveTextContent(`${meters(70)}${meters(50)}320280`);
    expect(card.textContent).toMatch(/600$/);
  });

  it("合計点と小計に「点」「小計」の文言を付けない", () => {
    // Given
    const distances = [marked(70, 320), marked(50, 280)];

    // When
    const round = renderRound({ total: 600, distances });

    // Then
    expect(round).not.toHaveTextContent("点");
    expect(round).not.toHaveTextContent("小計");
    expect(round.textContent).toMatch(/600$/);
  });

  it("距離が列の数以下なら全て表示し、列の数を超えるときだけ「+N」を出す(境界の両側)", () => {
    // Given
    const metrics = metricsOf(CELLS.four);

    // When
    const atLimit = renderRound({ distances: many(4) }, metrics);

    // Then
    expect(metersOf(atLimit)).toEqual(["100m", "90m", "80m", "70m"]);
    expect(atLimit).not.toHaveTextContent("+");
  });

  it.each([
    [CELLS.four, 5, ["100m", "90m", "80m"], 2],
    [CELLS.four, 6, ["100m", "90m", "80m"], 3],
    [CELLS.three, 5, ["100m", "90m"], 3],
    [CELLS.two, 5, ["100m"], 4],
  ])(
    "列の数に合う幅%spxで距離が%s個なら、(列の数-1)個の距離と、残りを示す「+N」を表示する",
    (available, count, shown, rest) => {
      // Given
      const metrics = metricsOf(available);

      // When
      const card = renderRound({ distances: many(count) }, metrics);

      // Then
      expect(metersOf(card)).toEqual(shown);
      expect(card).toHaveTextContent(
        roundsText("historyDistancesRest", { count: String(rest) }),
      );
    },
  );

  it("同じ測定値では、列の数を超える距離の数が違う行でも、列の数(「+N」を含む)が同じである", () => {
    // Given
    const metrics = metricsOf(CELLS.four);

    // When
    const five = renderRound({ distances: many(5) }, metrics);
    const fiveCells = metersOf(five).length + 1;
    cleanup();
    const six = renderRound({ distances: many(6) }, metrics);

    // Then
    expect(metersOf(six).length + 1).toBe(fiveCells);
  });

  it("距離が0件のラウンドは距離一覧を表示せず、合計点は表示する", () => {
    // Given
    const distances: DistanceSubtotal[] = [];

    // When
    const card = renderRound({ total: 0, distances });

    // Then
    expect(metersOf(card)).toEqual([]);
    expect(card.textContent).toMatch(/0$/);
  });

  it("フィールドの行はMarked/Unmarkedを距離に添え、距離のない無印は距離を表示しない", () => {
    // Given
    const distances: DistanceSubtotal[] = [
      { distance: 70, isMarked: true, total: 1 },
      { distance: 50, isMarked: false, total: 2 },
      { distance: null, isMarked: false, total: 3 },
    ];

    // When
    const card = renderRound({ format: "field", distances, total: 6 });

    // Then
    expect(card).toHaveTextContent(roundsText("distanceMarked"));
    expect(card).toHaveTextContent(roundsText("distanceUnmarked"));
    expect(metersOf(card)).toEqual(["70m", "50m"]);
  });

  it.each(["outdoor", "indoor"])(
    "フィールド以外(%s)の行はMarked/Unmarkedを表示せず、距離と小計を表示する",
    (format) => {
      // Given
      const distances: DistanceSubtotal[] = [
        { distance: 70, isMarked: true, total: 11 },
        { distance: 50, isMarked: false, total: 22 },
      ];

      // When
      const card = renderRound({ format, distances, total: 33 });

      // Then
      expect(card).not.toHaveTextContent(/marked/i);
      expect(card).toHaveTextContent(`${meters(70)}${meters(50)}1122`);
    },
  );

  it("ラウンド名が空のラウンドは名前を表示せず日付を表示する", () => {
    // Given
    const name = "";

    // When
    const card = renderRound({ name, roundDate: "2026-09-17", distances: [] });

    // Then
    expect(card).toHaveTextContent("2026/09/17");
    expect(card).not.toHaveTextContent("午前練習");
  });

  it.each([
    ["outdoor", "recurve"],
    ["indoor", "barebow"],
    ["field", "compound"],
  ])("種別(%s)と弓種(%s)を設定の表示名で表示する", (format, bowType) => {
    // Given
    const overrides = { format, bowType };

    // When
    const card = renderRound(overrides);

    // Then
    expect(card).toHaveTextContent(
      roundsText(`formatOption.${format as "outdoor"}`),
    );
    expect(card).toHaveTextContent(
      roundsText(`bowTypeOption.${bowType as "recurve"}`),
    );
  });

  it("測定の前は、合計点・日付・ラウンド名だけを表示する", () => {
    // Given
    // レイアウトのないjsdomでは幅が測れず、測定値がnullになる。
    const distances = [marked(70, 320), marked(50, 280)];

    // When
    const card = renderRound({ name: "午前練習", total: 600, distances }, null);

    // Then
    expect(card).toHaveTextContent("午前練習");
    expect(card).toHaveTextContent("2026/09/15");
    expect(card.textContent).toMatch(/600$/);
    expect(card).not.toHaveTextContent(roundsText("formatOption.outdoor"));
    expect(card).not.toHaveTextContent(roundsText("bowTypeOption.recurve"));
    expect(metersOf(card)).toEqual([]);
  });

  it("測定値の幅が足りないと、入らない要素は表示されず、合計点と日付は表示される", () => {
    // Given
    // 種別・弓種の文字が広く、距離一覧も入らない幅。
    const narrow: CardMetrics = {
      available: 150,
      date: 70,
      nameMin: 56,
      format: 200,
      bow: 200,
    };

    // When
    const card = renderRound(
      { total: 600, distances: [marked(70, 600)] },
      narrow,
    );

    // Then
    expect(card).toHaveTextContent("2026/09/15");
    expect(card.textContent).toMatch(/600$/);
    expect(card).not.toHaveTextContent(roundsText("formatOption.outdoor"));
    expect(metersOf(card)).toEqual([]);
  });

  it("行はメニューを持つ", () => {
    // Given
    const overrides = {};

    // When
    renderRound(overrides);

    // Then
    expect(screen.getByTestId("round-menu-trigger")).toBeInTheDocument();
  });
});

describe("DistanceCards", () => {
  it("日付・ラウンド名・種別・弓種・距離・小計を表示し、「小計」の文言と距離のn/Nを付けない", () => {
    // Given
    const overrides = {
      name: "午前練習",
      roundDate: "2026-09-15",
      format: "indoor",
      bowType: "barebow",
      distance: 30,
      total: 321,
    };

    // When
    const card = renderDistance(overrides);

    // Then
    expect(card).toHaveTextContent("2026/09/15");
    expect(card).toHaveTextContent("午前練習");
    expect(card).toHaveTextContent(roundsText("formatOption.indoor"));
    expect(card).toHaveTextContent(roundsText("bowTypeOption.barebow"));
    expect(card).toHaveTextContent(meters(30));
    expect(card.textContent).toMatch(/321$/);
    expect(card).not.toHaveTextContent("小計");
    expect(card.textContent?.replace("2026/09/15", "")).not.toMatch(/\d+\/\d+/);
  });

  it("フィールドの行はMarked/Unmarkedを距離に添え、フィールド以外は表示しない", () => {
    // Given
    const field = { format: "field", isMarked: false, distance: 50 };
    const outdoor = { format: "outdoor", isMarked: false, distance: 50 };

    // When
    const fieldCard = renderDistance(field);
    const fieldText = fieldCard.textContent;
    cleanup();
    const outdoorCard = renderDistance(outdoor);

    // Then
    expect(fieldText).toContain(roundsText("distanceUnmarked"));
    expect(outdoorCard).not.toHaveTextContent(/marked/i);
    expect(outdoorCard).toHaveTextContent(meters(50));
  });

  it("距離のない行は、距離を表示しない", () => {
    // Given
    const overrides = { distance: null, isMarked: false };

    // When
    const card = renderDistance(overrides);

    // Then
    expect(metersOf(card)).toEqual([]);
  });

  it("ラウンド名が空の行は名前を表示せず日付を表示する", () => {
    // Given
    const overrides = { name: "", roundDate: "2026-09-17" };

    // When
    const card = renderDistance(overrides);

    // Then
    expect(card).toHaveTextContent("2026/09/17");
  });

  it("測定の前は、小計・日付・ラウンド名だけを表示する", () => {
    // Given
    const overrides = { name: "午前練習", distance: 30, total: 321 };

    // When
    const card = renderDistance(overrides, null);

    // Then
    expect(card).toHaveTextContent("午前練習");
    expect(card).toHaveTextContent("2026/09/15");
    expect(card.textContent).toMatch(/321$/);
    expect(card).not.toHaveTextContent(roundsText("formatOption.outdoor"));
    expect(metersOf(card)).toEqual([]);
  });

  it("メニューを持たない", () => {
    // Given
    const overrides = {};

    // When
    renderDistance(overrides);

    // Then
    expect(screen.queryByTestId("round-menu-trigger")).toBeNull();
  });
});

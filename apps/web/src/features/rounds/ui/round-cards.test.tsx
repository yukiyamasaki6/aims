import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { DistanceSubtotal } from "../domain/round-list";
import { DistanceCards, RoundCards, RoundCardsSkeleton } from "./round-cards";
import {
  distanceListItem,
  roundListItem,
  stubCardLayout,
  WIDE_CARD_WIDTH,
} from "./round-stores-test-helpers";

const roundsText = translatorFor("rounds");

// jsdomは幅を測れないため、カードの幅は寸法のスタブで与える。
afterEach(() => {
  vi.restoreAllMocks();
});

// 距離一覧のセル数は、日付だけの左の塊に対して、245px以上で2、289px以上で3、333px以上で4になる(card-columns.test.tsの境界と同じ値)。
const CELLS = { two: 260, three: 300, four: 340 };

// availableがnullは、レイアウトのない状態(スタブを置かない)。
function renderWith(available: number | null, children: ReactNode) {
  if (available !== null) stubCardLayout(available);
  render(children, { wrapper: IntlTestProvider });
  return screen.getByRole("listitem");
}

function renderRound(
  overrides: Parameters<typeof roundListItem>[0] = {},
  available: number | null = WIDE_CARD_WIDTH,
) {
  return renderWith(
    available,
    <RoundCards
      rounds={[roundListItem(overrides)]}
      origin="history"
      onDelete={vi.fn()}
    />,
  );
}

function renderDistance(
  overrides: Parameters<typeof distanceListItem>[0] = {},
  available: number | null = WIDE_CARD_WIDTH,
) {
  return renderWith(
    available,
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
  it("距離が列の数以下なら全て表示し、列の数を超えるときだけ「+N」を出す(境界の両側)", () => {
    // Given
    // When
    const atLimit = renderRound({ distances: many(4) }, CELLS.four);

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
      // When
      const card = renderRound({ distances: many(count) }, available);

      // Then
      expect(metersOf(card)).toEqual(shown);
      expect(card).toHaveTextContent(
        roundsText("historyDistancesRest", { count: String(rest) }),
      );
    },
  );

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

describe("RoundCardsSkeleton", () => {
  it("ラウンドの取得中のスケルトンは3行である", () => {
    // Given
    // 描画だけを確かめ、棒の形や大きさは期待値にしない。

    // When
    render(<RoundCardsSkeleton />, { wrapper: IntlTestProvider });

    // Then
    expect(screen.getAllByTestId("round-skeleton-row")).toHaveLength(3);
  });
});

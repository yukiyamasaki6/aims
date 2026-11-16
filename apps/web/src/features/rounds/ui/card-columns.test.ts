import { describe, expect, it } from "vitest";
import {
  type CardContent,
  type CardKind,
  type CardWidths,
  type ColumnSelection,
  selectCardColumns,
} from "./card-columns";

// 固定の幅は寸法の定数と同じ値、文字の幅(日付・ラウンド名の最小幅・種別・弓種)は、境界を作りやすい値にする。
const widths: CardWidths = {
  gap: 8,
  total: 40,
  menu: 20,
  divider: 1,
  roundCell: 38,
  roundSeparator: 6,
  distanceCell: 44,
  tagPadding: 12,
  tagGap: 4,
  date: 70,
  nameMin: 56,
  format: 100,
  bow: 100,
};
const full: CardContent = { hasName: true, hasDistances: true };
const select = (
  kind: CardKind,
  available: number,
  overrides: Partial<CardWidths> = {},
  content: CardContent = full,
) => selectCardColumns(kind, available, { ...widths, ...overrides }, content);

const pick = (s: ColumnSelection) => ({
  total: s.total,
  date: s.date,
  cells: s.cells,
  name: s.name,
  format: s.format,
  bow: s.bow,
});
const shown = (
  names: (keyof ColumnSelection)[],
  cells = 0,
): ReturnType<typeof pick> => ({
  total: names.includes("total"),
  date: names.includes("date"),
  cells,
  name: names.includes("name"),
  format: names.includes("format"),
  bow: names.includes("bow"),
});

describe("selectCardColumns", () => {
  it("十分な幅では全ての要素を出し、距離一覧のセル数はラウンド単位が4、距離単位が1である", () => {
    // Given
    const available = 10_000;

    // When
    const round = select("round", available);
    const distance = select("distance", available);

    // Then
    expect(pick(round)).toEqual(
      shown(["total", "date", "name", "format", "bow"], 4),
    );
    expect(pick(distance)).toEqual(
      shown(["total", "date", "name", "format", "bow"], 1),
    );
  });

  describe("幅が足りないときは優先順位の低い要素から出なくなる", () => {
    // 必要な幅は、要素の幅と要素の間(8px)の和。ラウンド単位は合計点にメニューの場所(20px)が付く。
    it.each([
      // ラウンド単位。合計点、日付、距離一覧、ラウンド名、種別、弓種の順。
      [67, shown([])],
      [68, shown(["total"])],
      [145, shown(["total"])],
      [146, shown(["total", "date"])],
      [209, shown(["total", "date", "format"])],
      [245, shown(["total", "date"], 2)],
      [289, shown(["total", "date"], 3)],
      [333, shown(["total", "date"], 4)],
      [375, shown(["total", "date", "format"], 4)],
      [397, shown(["total", "date", "name", "format"], 4)],
      [491, shown(["total", "date", "name", "format", "bow"], 4)],
    ])("ラウンド単位は、幅%spxで%j", (available, expected) => {
      // Given
      const kind = "round";

      // When
      const selection = select(kind, available);

      // Then
      expect(pick(selection)).toEqual(expected);
    });

    it.each([
      // 距離単位。小計、日付、距離、ラウンド名、種別、弓種の順。
      [39, shown([])],
      [40, shown(["total"])],
      [100, shown(["total"])],
      [101, shown(["total"], 1)],
      [118, shown(["total", "date"], 0)],
      [178, shown(["total", "date", "format"])],
      [179, shown(["total", "date"], 1)],
      [243, shown(["total", "date", "name", "format"], 1)],
      [337, shown(["total", "date", "name", "format", "bow"], 1)],
    ])("距離単位は、幅%spxで%j", (available, expected) => {
      // Given
      const kind = "distance";

      // When
      const selection = select(kind, available);

      // Then
      expect(pick(selection)).toEqual(expected);
    });
  });

  it("入らない要素だけを出さず、より低い入る要素を出す", () => {
    // Given
    // 距離一覧(2セルで245px)は入らず、種別を足した幅(ラウンド名なしで188px)は入る。
    const available = 200;
    const content: CardContent = { hasName: false, hasDistances: true };

    // When
    const selection = select("round", available, {}, content);

    // Then
    expect(selection.cells).toBe(0);
    expect(selection.format).toBe(true);
  });

  it("ラウンド名は日付が入らない幅では出さず、最小幅に足りないときも出さない", () => {
    // Given
    const noDate = 145;
    const dateOnly = 200;

    // When
    const withoutDate = select("round", noDate);
    const tooNarrowName = select("round", dateOnly, { nameMin: 300 });

    // Then
    expect(withoutDate.name).toBe(false);
    expect(tooNarrowName.date).toBe(true);
    expect(tooNarrowName.name).toBe(false);
  });

  it("弓種は種別が出ているときだけ出す", () => {
    // Given
    // 種別が入らず(512px)、弓種だけなら入る(10px)幅。
    const available = 400;

    // When
    const selection = select("round", available, { format: 500, bow: 10 });

    // Then
    expect(selection.format).toBe(false);
    expect(selection.bow).toBe(false);
  });

  it.each([
    [333, 4],
    [289, 3],
    [245, 2],
    [244, 0],
  ])(
    "距離一覧のセル数は、幅%spxで入る最大の数(%s)にする",
    (available, cells) => {
      // Given
      const content: CardContent = { hasName: false, hasDistances: true };

      // When
      const selection = select("round", available, { format: 1_000 }, content);

      // Then
      expect(selection.cells).toBe(cells);
    },
  );

  it("距離一覧のセル数は、4セルが入る幅を大きく超える幅でも4のままである", () => {
    // Given
    const wide = 333 * 5;

    // When
    const selection = select("round", wide);

    // Then
    expect(selection.cells).toBe(4);
  });

  it("セル数は、ラウンド名・種別・弓種の内容に左右されない", () => {
    // Given
    const available = 333;
    const variants: [Partial<CardWidths>, CardContent][] = [
      [{}, full],
      [{ format: 10, bow: 10 }, full],
      [
        { format: 300, bow: 300 },
        { hasName: false, hasDistances: true },
      ],
    ];

    // When
    const cells = variants.map(
      ([overrides, content]) =>
        select("round", available, overrides, content).cells,
    );

    // Then
    expect(cells).toEqual([4, 4, 4]);
  });

  it("ラウンド名が空のときは名前を出さず、他の要素の選択は変わらない", () => {
    // Given
    const available = 10_000;

    // When
    const selection = select(
      "round",
      available,
      {},
      {
        hasName: false,
        hasDistances: true,
      },
    );

    // Then
    expect(pick(selection)).toEqual(
      shown(["total", "date", "format", "bow"], 4),
    );
  });

  it("距離が0件のときは距離一覧を出さず、他の要素の選択は変わらない", () => {
    // Given
    const available = 10_000;

    // When
    const selection = select(
      "round",
      available,
      {},
      {
        hasName: true,
        hasDistances: false,
      },
    );

    // Then
    expect(pick(selection)).toEqual(
      shown(["total", "date", "name", "format", "bow"], 0),
    );
  });

  it("合計点も入らない幅では何も出さない", () => {
    // Given
    const available = 10;

    // When
    const round = select("round", available);
    const distance = select("distance", available);

    // Then
    expect(pick(round)).toEqual(shown([]));
    expect(pick(distance)).toEqual(shown([]));
  });
});

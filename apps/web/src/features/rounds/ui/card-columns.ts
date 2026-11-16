// 点数カードの列の出し分け(貪欲法)。優先順位の高い要素から順に、残りの幅に入るなら出し、入らなければその要素だけ出さず、次の要素を入るなら出す。幅は測定した値を受ける純粋な関数で、測定は use-card-fit.ts が行う。
//
// 優先順位(高→低): 合計点(ラウンド単位はメニューの場所とセット)、日付、距離一覧(距離単位は距離)、ラウンド名、種別、弓種。
// ラウンド名は日付が出ているときだけ、弓種は種別が出ているときだけ出す。ラウンド名がない・距離がないカードは、その要素を出さない。
// どの要素も、入らなければ出さない(合計点・日付も同じ。実際の画面の最小の幅では入る)。
// ラウンド名は最小幅(nameMin)に入るときだけ出し、残りの幅で「…」で切る(切るのは表示側)。
// 距離一覧のセル数(「+N」のセルも1つ)は、ラウンド単位が 4・3・2 のうち入る最大の数(2つでも入らなければ出さない)、距離単位は1つ。セル数は日付の幅と固定の幅だけで決まるので、同じ画面幅なら全カードで同じ数になる。

export type CardKind = "round" | "distance";

// 各要素の幅(px)。date・nameMin・format・bow は測定した文字の幅、そのほかは固定の幅(card-layout.ts)。
export interface CardWidths {
  gap: number;
  total: number;
  menu: number;
  divider: number;
  roundCell: number;
  roundSeparator: number;
  distanceCell: number;
  tagPadding: number;
  tagGap: number;
  date: number;
  nameMin: number;
  format: number;
  bow: number;
}

export interface CardContent {
  hasName: boolean;
  hasDistances: boolean;
}

export interface ColumnSelection {
  total: boolean;
  date: boolean;
  // 距離・小計のセル数。0は出さない。
  cells: number;
  name: boolean;
  format: boolean;
  bow: boolean;
}

// 測定の前(サーバーの描画、最初の描画の前、測定できない環境)に出す要素。
export const BASE_COLUMNS: ColumnSelection = {
  total: true,
  date: true,
  cells: 0,
  name: true,
  format: false,
  bow: false,
};

const NOTHING: ColumnSelection = {
  total: false,
  date: false,
  cells: 0,
  name: false,
  format: false,
  bow: false,
};

const CELL_COUNTS = { round: [4, 3, 2], distance: [1] } as const;

// 距離・小計の列の幅(セルと、その間の区切り)。距離単位は距離のセルだけ。
export function stripWidth(
  kind: CardKind,
  cells: number,
  w: Pick<CardWidths, "roundCell" | "roundSeparator" | "distanceCell">,
): number {
  return kind === "distance"
    ? w.distanceCell
    : w.roundCell * cells + w.roundSeparator * (cells - 1);
}

// 左の塊の幅。日付の行(日付とラウンド名)とタグの行(種別と弓種)の広いほう。
function blockWidth(s: ColumnSelection, w: CardWidths): number {
  if ((s.name && !s.date) || (s.bow && !s.format)) {
    return Number.POSITIVE_INFINITY;
  }
  const dateRow = s.date ? w.date + (s.name ? w.gap + w.nameMin : 0) : 0;
  const formatTag = s.format ? w.format + w.tagPadding : 0;
  const tagRow = s.bow
    ? formatTag + w.tagGap + w.bow + w.tagPadding
    : formatTag;
  return Math.max(dateRow, tagRow);
}

// 出す要素を並べるのに必要な幅(列の間隔を含む)。
function requiredWidth(
  kind: CardKind,
  s: ColumnSelection,
  w: CardWidths,
): number {
  const parts = [blockWidth(s, w)].filter((part) => part > 0);
  if (s.cells > 0) parts.push(stripWidth(kind, s.cells, w), w.divider);
  if (s.total) parts.push(w.total);
  if (s.total && kind === "round") parts.push(w.menu);
  const sum = parts.reduce((total, part) => total + part, 0);
  return parts.length === 0 ? 0 : sum + w.gap * (parts.length - 1);
}

export function selectCardColumns(
  kind: CardKind,
  available: number,
  w: CardWidths,
  content: CardContent,
): ColumnSelection {
  let selected = NOTHING;
  const tryAdd = (change: Partial<ColumnSelection>): boolean => {
    const next = { ...selected, ...change };
    if (requiredWidth(kind, next, w) > available) return false;
    selected = next;
    return true;
  };
  tryAdd({ total: true });
  tryAdd({ date: true });
  if (content.hasDistances) {
    CELL_COUNTS[kind].some((cells) => tryAdd({ cells }));
  }
  if (content.hasName) tryAdd({ name: true });
  tryAdd({ format: true });
  tryAdd({ bow: true });
  return selected;
}

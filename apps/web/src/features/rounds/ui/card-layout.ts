// 点数カード(行)の寸法。幅の数値は`widthPx`の1か所に持ち、CSSの幅・間隔と、列の出し分けの計算(card-columns.ts)の両方が使う。
export const cardLayout = {
  // 行の高さ(上下の余白6px×2+内側48px)。内側は3段: 距離一覧は Marked/Unmarked 12px+距離20px+小計16px、左の塊は 上に日付・ラウンド名20px と 下にタグ16px。
  height: "h-[60px]",
  // 行の下の境界線(1px)を含む高さ。スケルトンと末尾・0件の領域の高さをそろえる。
  heightWithLine: "h-[61px]",
  // 左右の12pxは、押せる行のhoverの背景を内容の外へ広げる(リストを-mx-3で広げ、内容は本文の端にそろう)。
  padding: "px-3 py-1.5",
  widthPx: {
    gap: 8,
    total: 40,
    menu: 20,
    divider: 1,
    // 中央の距離・小計の1列(「100m」14pxの約35px、7.5pxの「Unmarked」約34.6px、4桁の小計約27pxが収まる値)と、列の間の区切り。
    roundCell: 38,
    roundSeparator: 6,
    distanceCell: 44,
    // タグの左右の余白の和と、タグの間。
    tagPadding: 12,
    tagGap: 4,
  },
  // 文字の幅の測定に使う文字の大きさ・太さ(日付はtext-sm、タグは11pxのfont-semibold)。
  dateFont: { fontSize: "14px" },
  tagFont: { fontSize: "11px", fontWeight: "600" },
  // 距離のまとまりの上の段(Marked/Unmarked)。最長の「Unmarked」が、下の段の「100m」の幅を超えない大きさにする。
  markText: "h-2 text-[7.5px] leading-[8px] text-muted-foreground font-normal",
  distanceMarkText: "text-[9px] leading-3 text-muted-foreground",
  // 距離・小計の列の間の区切り線。カードの縦線(bg-border)より薄い。
  columnDivider: "w-px bg-border/50",
} as const;

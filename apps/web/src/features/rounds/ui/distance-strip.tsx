import { useTranslations } from "next-intl";
import type { DistanceSubtotal } from "../domain/round-list";
import { stripWidth } from "./card-columns";
import { cardLayout } from "./card-layout";

const { roundCell, roundSeparator } = cardLayout.widthPx;

// 距離のまとまりの文字。フィールドだけ、上の段にMarked/Unmarkedを出す。フィールド以外は距離だけ。距離が無いときは、どちらも距離の段を空にする。
export function useDistanceParts() {
  const t = useTranslations("rounds");
  return (
    { distance, isMarked }: Pick<DistanceSubtotal, "distance" | "isMarked">,
    format: string,
  ): { mark: string; distance: string } => {
    const text =
      distance === null
        ? ""
        : t("historyDistanceMarked", { distance: String(distance) });
    if (format !== "field") return { mark: "", distance: text };
    return {
      mark: t(isMarked ? "distanceMarked" : "distanceUnmarked"),
      distance: text,
    };
  };
}

// 距離のまとまり。上の段にMarked/Unmarked、下の段に距離。
export function DistanceLabel({
  mark,
  distance,
  alignClassName,
  markClassName = cardLayout.markText,
}: {
  mark: string;
  distance: string;
  alignClassName: string;
  markClassName?: string;
}) {
  return (
    <span className={`flex flex-col gap-0.5 ${alignClassName}`}>
      {mark !== "" && <span className={markClassName}>{mark}</span>}
      <span>{distance}</span>
    </span>
  );
}

// 距離の数がセル数(「+N」のセルも1つと数える)以下なら全部、多ければ(セル数-1)個の距離と、最後のセルに残りの距離数「+N」。
function useStripCells(
  distances: DistanceSubtotal[],
  format: string,
  cellCount: number,
) {
  const t = useTranslations("rounds");
  const distanceParts = useDistanceParts();
  const truncated = distances.length > cellCount;
  const shown = truncated ? distances.slice(0, cellCount - 1) : distances;
  const cells = shown.map((d, position) => ({
    key: `column-${position}`,
    more: false,
    ...distanceParts(d, format),
    total: String(d.total),
  }));
  if (truncated) {
    cells.push({
      key: "column-more",
      more: true,
      mark: "",
      distance: t("historyDistancesRest", {
        count: String(distances.length - shown.length),
      }),
      total: "",
    });
  }
  return cells;
}

type StripCell = ReturnType<typeof useStripCells>[number];

// 段: Marked/Unmarked(フィールドだけ)、距離、小計。縦線は距離と小計の段にだけ引く。
const STRIP_ROWS = [
  {
    id: "mark",
    height: "12px",
    cellClassName: "flex items-end justify-center text-muted-foreground",
    content: (c: StripCell) => (
      <span className={cardLayout.markText}>{c.mark}</span>
    ),
    divider: null,
  },
  {
    id: "distance",
    height: "20px",
    cellClassName:
      "flex items-center justify-center font-medium text-sm leading-[14px]",
    content: (c: StripCell) => c.distance,
    divider: "h-4",
  },
  {
    id: "total",
    height: "16px",
    cellClassName:
      "flex items-center justify-center text-muted-foreground text-xs leading-4 tabular-nums",
    content: (c: StripCell) => c.total,
    divider: "h-2.5",
  },
] as const;

// ラウンド単位の中央の列。距離と小計を同じ列に、全カード共通の固定幅で右揃えに並べる(同じセル数なら全カードで列の位置が一致する)。「+N」のセルは段をまたぎ、まとまりの上下中央に置く。Marked/Unmarked の段は、フィールドだけに取る。
export function DistanceStrip({
  distances,
  format,
  cellCount,
}: {
  distances: DistanceSubtotal[];
  format: string;
  cellCount: number;
}) {
  const cells = useStripCells(distances, format, cellCount);
  const rows = STRIP_ROWS.filter(
    (row) => row.id !== "mark" || format === "field",
  );
  const columns = cells
    .map((_, i) =>
      i === 0 ? `${roundCell}px` : `${roundSeparator}px ${roundCell}px`,
    )
    .join(" ");
  return (
    <span
      className="flex shrink-0 justify-end"
      style={{ width: stripWidth("round", cellCount, cardLayout.widthPx) }}
    >
      <span
        className="grid w-fit whitespace-nowrap"
        style={{
          gridTemplateColumns: columns,
          gridTemplateRows: rows.map((row) => row.height).join(" "),
        }}
      >
        {rows.flatMap((row, rowIndex) =>
          cells.flatMap((c, i) => [
            i > 0 && (
              <span
                key={`${row.id}-${c.key}-divider`}
                className="flex items-center justify-center"
              >
                {row.divider !== null && (
                  <span
                    className={`${row.divider} ${cardLayout.columnDivider}`}
                  />
                )}
              </span>
            ),
            c.more ? (
              rowIndex === 0 && (
                <span
                  key={c.key}
                  className="flex items-center justify-center text-muted-foreground text-xs"
                  style={{ gridRow: "1 / -1", gridColumn: 2 * i + 1 }}
                >
                  {c.distance}
                </span>
              )
            ) : (
              <span key={`${row.id}-${c.key}`} className={row.cellClassName}>
                {row.content(c)}
              </span>
            ),
          ]),
        )}
      </span>
    </span>
  );
}

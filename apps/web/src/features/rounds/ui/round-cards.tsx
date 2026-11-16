import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { roundPath } from "@/routes";
import { formatCardDate } from "../domain/round-date";
import type { DistanceListItem, RoundListItem } from "../domain/round-list";
import type { RoundOrigin } from "../domain/round-routes";
import {
  BASE_COLUMNS,
  type CardKind,
  type CardWidths,
  type ColumnSelection,
  selectCardColumns,
} from "./card-columns";
import { cardLayout } from "./card-layout";
import {
  DistanceLabel,
  DistanceStrip,
  useDistanceParts,
} from "./distance-strip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Skeleton } from "./skeleton";
import { useCardFit } from "./use-card-fit";
import { useOptionLabels } from "./use-option-labels";

const { widthPx } = cardLayout;
// 測定の効果の依存になるため、描画のたびに作り直さない定数にする。
const CARD_FONTS = { date: cardLayout.dateFont, tag: cardLayout.tagFont };

// 行は、境界の線(下側)だけで区切る(枠・背景・影はない)。リストは左右に-mx-3で広げ、行の内容を本文の端にそろえる。
const listClassName = "-mx-3 border-t";
const rowClassName = `flex ${cardLayout.height} items-center ${cardLayout.padding} text-card-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`;

// 読み込み後の行と同じ高さ(境界線を含む)。履歴の取得は、描いた1件の高さと間隔(0)から1ページの件数を決める(data-round-skeleton)。
export function RoundCardsSkeleton() {
  return (
    <div className={listClassName}>
      {[0, 1, 2].map((i) => (
        <Skeleton
          key={i}
          data-round-skeleton
          className={`${cardLayout.heightWithLine} rounded-none border-b`}
        />
      ))}
    </div>
  );
}

// 履歴の末尾と0件の文言。行1つと同じ幅・高さの領域の中央に置く。
export function HistoryNotice({ children }: { children: string }) {
  return (
    <p
      className={`-mx-3 flex ${cardLayout.heightWithLine} items-center justify-center border-b p-4 text-center text-muted-foreground text-sm`}
    >
      {children}
    </p>
  );
}

// 左の塊。左上に日付とラウンド名(足りないときは「…」で切る)、左下に種別と弓種のタグ。どの要素も、列の出し分けで入るときだけ出す。
function NameBlock({
  name,
  date,
  format,
  bowType,
  shown,
}: {
  name: string;
  date: string;
  format: string;
  bowType: string;
  shown: ColumnSelection;
}) {
  const { formatLabel, bowTypeLabel } = useOptionLabels();
  const tag = (label: string) => (
    <span
      className="rounded bg-muted"
      style={{ paddingInline: widthPx.tagPadding / 2 }}
    >
      {label}
    </span>
  );
  return (
    <span className="flex min-w-0 flex-1 flex-col justify-between self-stretch overflow-hidden">
      <span
        className="flex h-5 whitespace-nowrap text-muted-foreground text-sm"
        style={{ gap: widthPx.gap }}
      >
        {shown.date && <span className="shrink-0">{formatCardDate(date)}</span>}
        {shown.name && <span className="min-w-0 truncate">{name}</span>}
      </span>
      <span
        className="flex h-4 whitespace-nowrap font-semibold text-[11px] leading-4"
        style={{ gap: widthPx.tagGap }}
      >
        {shown.format && tag(formatLabel(format))}
        {shown.bow && tag(bowTypeLabel(bowType))}
      </span>
    </span>
  );
}

// 行。左の塊と、種類ごとの右側(trailing)を、列の出し分けの結果に合わせて並べる。
function CardRow({
  kind,
  href,
  item,
  hasDistances,
  trailing,
}: {
  kind: CardKind;
  href: string;
  item: { name: string; roundDate: string; format: string; bowType: string };
  hasDistances: boolean;
  trailing: (shown: ColumnSelection) => ReactNode;
}) {
  const { formatLabel, bowTypeLabel } = useOptionLabels();
  const { ref, metrics } = useCardFit(
    { format: formatLabel(item.format), bow: bowTypeLabel(item.bowType) },
    CARD_FONTS,
  );
  const shown =
    metrics === null
      ? BASE_COLUMNS
      : selectCardColumns(
          kind,
          metrics.available,
          { ...widthPx, ...metrics } satisfies CardWidths,
          { hasName: item.name !== "", hasDistances },
        );
  return (
    <Link
      ref={ref}
      href={href}
      className={rowClassName}
      style={{ gap: widthPx.gap }}
    >
      <NameBlock
        name={item.name}
        date={item.roundDate}
        format={item.format}
        bowType={item.bowType}
        shown={shown}
      />
      {trailing(shown)}
    </Link>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 self-stretch bg-border"
      style={{ width: widthPx.divider }}
    />
  );
}

// 合計点(距離単位では小計)。固定幅の列の中で右揃え。
function Total({ children }: { children: number }) {
  return (
    <span
      className="shrink-0 whitespace-nowrap text-right font-semibold text-lg"
      style={{ width: widthPx.total }}
    >
      {children}
    </span>
  );
}

function RoundCardItem({
  round,
  origin,
  onDelete,
}: {
  round: RoundListItem;
  origin: RoundOrigin;
  onDelete: (round: RoundListItem) => void;
}) {
  const t = useTranslations("rounds");
  return (
    <li className="relative border-b">
      <CardRow
        kind="round"
        href={roundPath(round.id, origin)}
        item={round}
        hasDistances={round.distances.length > 0}
        trailing={(shown) => (
          <>
            {shown.cells > 0 && (
              <>
                <DistanceStrip
                  distances={round.distances}
                  format={round.format}
                  cellCount={shown.cells}
                />
                <Divider />
              </>
            )}
            {shown.total && (
              <>
                <Total>{round.total}</Total>
                {/* メニューのアイコンの場所(アイコンは下のボタンが右端に置く)。 */}
                <span
                  aria-hidden="true"
                  className="shrink-0"
                  style={{ width: widthPx.menu }}
                />
              </>
            )}
          </>
        )}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={
            round.name === ""
              ? t("roundMenuLabel")
              : t("roundMenuLabelNamed", { name: round.name })
          }
          data-testid="round-menu-trigger"
          className="-translate-y-1/2 absolute top-1/2 right-1 p-2 text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            data-testid="round-delete"
            className="text-destructive data-[highlighted]:text-destructive"
            onClick={() => onDelete(round)}
          >
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

// origin: 行から開く詳細の遷移元。履歴だけが"history"を渡す(ホームは"home"でクエリなし)。
export function RoundCards({
  rounds,
  origin,
  onDelete,
}: {
  rounds: RoundListItem[];
  origin: RoundOrigin;
  onDelete: (round: RoundListItem) => void;
}) {
  return (
    <ul className={listClassName}>
      {rounds.map((round) => (
        <RoundCardItem
          key={round.id}
          round={round}
          origin={origin}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

function DistanceCardItem({
  item,
  origin,
}: {
  item: DistanceListItem;
  origin: RoundOrigin;
}) {
  const distanceParts = useDistanceParts();
  return (
    <li className="border-b">
      <CardRow
        kind="distance"
        href={roundPath(item.roundId, origin)}
        item={item}
        hasDistances
        trailing={(shown) => (
          <>
            {shown.cells > 0 && (
              <>
                <span
                  className="flex shrink-0 justify-end whitespace-nowrap text-base leading-5"
                  style={{ width: widthPx.distanceCell }}
                >
                  <DistanceLabel
                    {...distanceParts(item, item.format)}
                    alignClassName="items-end"
                    markClassName={cardLayout.distanceMarkText}
                  />
                </span>
                <Divider />
              </>
            )}
            {shown.total && <Total>{item.total}</Total>}
          </>
        )}
      />
    </li>
  );
}

// 距離単位の行。行からそのラウンドの詳細へ移る。削除のメニューは置かない。
export function DistanceCards({
  distances,
  origin,
}: {
  distances: DistanceListItem[];
  origin: RoundOrigin;
}) {
  return (
    <ul className={listClassName}>
      {distances.map((item) => (
        <DistanceCardItem key={item.id} item={item} origin={origin} />
      ))}
    </ul>
  );
}

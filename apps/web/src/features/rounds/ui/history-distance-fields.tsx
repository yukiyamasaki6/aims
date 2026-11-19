"use client";

import { ChevronRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HistoryDistanceRow } from "../domain/history-view-state";
import { lookupTargetFace, type TargetFaceOption } from "../domain/target-face";
import { HistoryDistanceDialog } from "./history-distance-dialog";
import {
  type TargetFilter,
  useSavedTargetFaces,
} from "./history-target-selection";
import { DistanceInfo } from "./preset-info";

// 要約の距離をMarked/Unmarkedの表記にせず、`{distance}m`で出すための種別(フィールド以外)。
const SUMMARY_FORMAT = "outdoor";

const SUMMARY_CLASS =
  "flex w-full items-center gap-1 rounded-xl border bg-card px-3 py-2 text-left text-muted-foreground text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const ADD_CLASS = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "h-12 border-dashed",
);

// 確定した距離の要約。ラウンド詳細の距離のカード先頭と同じ見せ方(`DistanceInfo`と右端の矢印)。
function DistanceSummary({
  row,
  targetFaces,
}: {
  row: HistoryDistanceRow;
  targetFaces: TargetFaceOption[];
}) {
  return (
    <>
      <DistanceInfo
        distance={row.distance}
        isMarked
        format={SUMMARY_FORMAT}
        face={
          row.targetFaceId === null
            ? null
            : lookupTargetFace(targetFaces, row.targetFaceId)
        }
        arrowsPerEnd={row.arrowsPerEnd}
        totalEnds={null}
      />
      <ChevronRight className="ml-auto size-4 shrink-0" />
    </>
  );
}

// 入力欄の見出し。ラウンド構成と距離構成で同じ見た目にする。
function GroupLabel({ children }: { children: string }) {
  return <span className="text-muted-foreground text-sm">{children}</span>;
}

function AddLabel({ children }: { children: string }) {
  return (
    <>
      <Plus />
      {children}
    </>
  );
}

// ラウンド構成の入力。追加済みの距離の要約を射つ順に並べ、その下の「距離を追加」で増やす。要約を押すと編集(保存・削除)になる。値(確定済みの行)を受けて、変更を返すだけである。
export function HistoryDistanceList({
  rows,
  filter,
  onChange,
}: {
  rows: readonly HistoryDistanceRow[];
  filter: TargetFilter;
  onChange: (rows: HistoryDistanceRow[]) => void;
}) {
  const t = useTranslations("rounds");
  const targetFaces = useSavedTargetFaces();
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={listRef} className="flex flex-col gap-2">
      <GroupLabel>{t("historyFilterDistances")}</GroupLabel>
      {rows.map((row, index) => (
        <HistoryDistanceDialog
          // biome-ignore lint/suspicious/noArrayIndexKey: 行は位置で識別する(同じ値の行がありうる)。編集で値が変わっても、閉じた後のフォーカス復帰先のトリガーを保つ
          key={index}
          mode="edit"
          row={row}
          filter={filter}
          trigger={<DistanceSummary row={row} targetFaces={targetFaces} />}
          triggerTestId={`history-filter-distance-${index}`}
          triggerClassName={SUMMARY_CLASS}
          onConfirm={(next) =>
            onChange(rows.map((r, i) => (i === index ? next : r)))
          }
          onDelete={() => onChange(rows.filter((_, i) => i !== index))}
          deletedFocus={() =>
            listRef.current?.querySelector<HTMLButtonElement>(
              '[data-testid="history-filter-distance-add"]',
            ) ?? null
          }
        />
      ))}
      <HistoryDistanceDialog
        mode="add"
        row={null}
        filter={filter}
        trigger={<AddLabel>{t("addDistance")}</AddLabel>}
        triggerTestId="history-filter-distance-add"
        triggerClassName={ADD_CLASS}
        onConfirm={(next) => onChange([...rows, next])}
      />
    </div>
  );
}

// 距離単位の絞り込む距離の入力(1件)。未指定なら「距離を選択」、指定済みなら要約を出す。要約を押すと同じダイアログで選び直し(保存)、削除で指定を外す。
export function HistoryDistanceSelect({
  row,
  filter,
  onChange,
}: {
  row: HistoryDistanceRow | null;
  filter: TargetFilter;
  onChange: (row: HistoryDistanceRow | null) => void;
}) {
  const t = useTranslations("rounds");
  const targetFaces = useSavedTargetFaces();
  return (
    <div className="flex flex-col gap-2">
      <GroupLabel>{t("historyFilterDistanceGroup")}</GroupLabel>
      <HistoryDistanceDialog
        mode={row === null ? "select" : "edit"}
        row={row}
        filter={filter}
        trigger={
          row === null ? (
            <AddLabel>{t("historyFilterDistanceSelect")}</AddLabel>
          ) : (
            <DistanceSummary row={row} targetFaces={targetFaces} />
          )
        }
        triggerTestId={
          row === null
            ? "history-filter-distance-select"
            : "history-filter-distance-row"
        }
        triggerClassName={row === null ? ADD_CLASS : SUMMARY_CLASS}
        onConfirm={onChange}
        onDelete={row === null ? undefined : () => onChange(null)}
      />
    </div>
  );
}

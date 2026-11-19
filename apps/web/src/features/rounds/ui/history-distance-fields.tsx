"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, type RefObject, useRef } from "react";
import { cn } from "@/lib/utils";
import type { HistoryDistanceRow } from "../domain/history-view-state";
import { lookupTargetFace, type TargetFaceOption } from "../domain/target-face";
import { HistoryDistanceDialog } from "./history-distance-dialog";
import {
  type TargetFilter,
  useSavedTargetFaces,
} from "./history-target-selection";
import { TargetFaceIcon } from "./target-face-info";

// 距離のタイルと追加のタイルの大きさ(幅80px、高さ112px)。縦長で固定にし、項目の有無で並びの高さがばらつかないようにする。
const TILE_SIZE_CLASS = "h-28 w-20 shrink-0";
// 的の図の領域(図と同じ48px)。未指定(空)と見つからない表示も同じ領域に収める。
const FACE_SIZE = 48;

const TILE_CLASS = cn(
  TILE_SIZE_CLASS,
  "flex flex-col items-center justify-between rounded-xl border bg-card p-2 text-center text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
);
const ADD_TILE_CLASS = cn(
  TILE_SIZE_CLASS,
  "flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-background p-2 text-center text-sm outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
);

// 確定した距離のタイルの中身。上から距離、射数/エンド、的の図だけを固定の位置に置く。
function DistanceTileContent({
  row,
  targetFaces,
}: {
  row: HistoryDistanceRow;
  targetFaces: TargetFaceOption[];
}) {
  const t = useTranslations("rounds");
  const face =
    row.targetFaceId === null
      ? null
      : lookupTargetFace(targetFaces, row.targetFaceId);
  return (
    <>
      <span className="leading-5">
        {t("historyDistanceMarked", { distance: String(row.distance) })}
      </span>
      <span className="h-5 text-muted-foreground leading-5">
        {row.arrowsPerEnd !== null &&
          t("distanceArrowsPerEnd", {
            arrowsPerEnd: String(row.arrowsPerEnd),
          })}
      </span>
      <span
        className="flex items-center justify-center overflow-hidden text-muted-foreground text-xs"
        style={{ width: FACE_SIZE, height: FACE_SIZE }}
      >
        {face === "missing" && t("targetFaceMissing")}
        {face !== null && face !== "missing" && (
          <TargetFaceIcon spots={face.target_face_spots} size={FACE_SIZE} />
        )}
      </span>
    </>
  );
}

// タイルを横へ並べる並び。折り返さず、並びの中だけで横にスライドする。フォーカスの輪が切り取られないよう、内側に余白を持つ。
function TileRow({
  children,
  listRef,
}: {
  children: ReactNode;
  listRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={listRef}
      className="flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain p-1"
    >
      {children}
    </div>
  );
}

// 入力欄の見出し。ラウンド構成と距離構成で同じ見た目にする。
function GroupLabel({ children }: { children: string }) {
  return <span className="text-muted-foreground text-sm">{children}</span>;
}

function AddLabel({ children }: { children: string }) {
  return (
    <>
      <Plus className="size-6 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{children}</span>
    </>
  );
}

// ラウンド構成の入力。追加済みの距離のタイルを射つ順に横へ並べ、末尾の追加のタイルで増やす。タイルを押すと編集(保存・削除)になる。値(確定済みの行)を受けて、変更を返すだけである。
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
    <div className="flex min-w-0 flex-col gap-2">
      <GroupLabel>{t("historyFilterDistances")}</GroupLabel>
      <TileRow listRef={listRef}>
        {rows.map((row, index) => (
          <HistoryDistanceDialog
            // biome-ignore lint/suspicious/noArrayIndexKey: 行は位置で識別する(同じ値の行がありうる)。編集で値が変わっても、閉じた後のフォーカス復帰先のトリガーを保つ
            key={index}
            mode="edit"
            row={row}
            filter={filter}
            trigger={
              <DistanceTileContent row={row} targetFaces={targetFaces} />
            }
            triggerTestId={`history-filter-distance-${index}`}
            triggerClassName={TILE_CLASS}
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
          triggerClassName={ADD_TILE_CLASS}
          onConfirm={(next) => onChange([...rows, next])}
        />
      </TileRow>
    </div>
  );
}

// 距離単位の絞り込む距離の入力(1件)。未指定なら「距離を選択」(追加のタイルと同じ大きさの破線の枠)、指定済みなら距離のタイルを出す。タイルを押すと同じダイアログで選び直し(保存)、削除で指定を外す。
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
    <div className="flex min-w-0 flex-col gap-2">
      <GroupLabel>{t("historyFilterDistanceGroup")}</GroupLabel>
      <TileRow>
        <HistoryDistanceDialog
          mode={row === null ? "select" : "edit"}
          row={row}
          filter={filter}
          trigger={
            row === null ? (
              <AddLabel>{t("historyFilterDistanceSelect")}</AddLabel>
            ) : (
              <DistanceTileContent row={row} targetFaces={targetFaces} />
            )
          }
          triggerTestId={
            row === null
              ? "history-filter-distance-select"
              : "history-filter-distance-row"
          }
          triggerClassName={row === null ? ADD_TILE_CLASS : TILE_CLASS}
          onConfirm={onChange}
          onDelete={row === null ? undefined : () => onChange(null)}
        />
      </TileRow>
    </div>
  );
}

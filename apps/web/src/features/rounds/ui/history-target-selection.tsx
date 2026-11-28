"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { HistoryInput } from "../domain/history-view-state";
import { lookupTargetFace, type TargetFaceOption } from "../domain/target-face";
import { FILTER_ALL, filterTargetFaces } from "../domain/target-face-filter";
import { useRoundProcedures } from "./rounds-context";
import { TargetFaceInfo } from "./target-face-info";
import {
  TargetFaceFilters,
  TargetFaceList,
  targetFaceTriggerLabel,
} from "./target-face-picker";
import { useTargetFaceLabel } from "./use-target-face-label";

// 的の選択欄の既定にする、編集中の種別・弓種。
export type TargetFilter = Pick<HistoryInput, "format" | "bowType">;

// 的の領域の寸法(履歴専用)。的の情報(`TargetFaceInfo`)の実寸(幅は全体像48+間隔4+拡大図75、高さは全体像48)。的の情報、的が見つからない表示、指定なしの表示は、全てこの寸法の入れ物に入れ、選んでも行や一覧の項目の大きさが変わらないようにする。`TargetFaceInfo`自体は他の画面と共有するため寸法を持たせない。
const TARGET_SLOT_SIZE = { width: 127, height: 48 };

function TargetSlot({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex items-center justify-center overflow-hidden text-center text-sm"
      style={TARGET_SLOT_SIZE}
    >
      {children}
    </span>
  );
}

// 的の選択の一覧。種別・弓種の選択欄の既定は、編集中の種別・弓種(指定なしなら「指定なし」)。一覧の先頭の「指定なし」で的を外す。
function TargetFaceChoice({
  testId,
  selectedId,
  targetFaces,
  filter,
  onSelect,
  description,
  children,
}: {
  testId: string;
  selectedId: string | null;
  targetFaces: TargetFaceOption[];
  filter: TargetFilter;
  onSelect: (id: string | null) => void;
  description: string;
  children: ReactNode;
}) {
  const t = useTranslations("rounds");
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<string>(filter.format ?? FILTER_ALL);
  const [bowType, setBowType] = useState<string>(filter.bowType ?? FILTER_ALL);
  const select = (id: string | null) => {
    onSelect(id);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        id={testId}
        data-testid={testId}
        aria-describedby={`${testId}-description`}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg border border-border bg-background p-2 outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        {children}
      </DialogTrigger>
      <span id={`${testId}-description`} className="sr-only">
        {description}
      </span>
      <DialogContent
        nested
        className="flex h-[70vh] flex-col overflow-y-hidden"
      >
        <div className="flex h-full flex-col gap-3">
          <TargetFaceFilters
            format={format}
            bowType={bowType}
            onFormatChange={setFormat}
            onBowTypeChange={setBowType}
          />
          <TargetFaceList
            faces={filterTargetFaces(targetFaces, format, bowType)}
            selectedId={selectedId}
            onSelect={select}
            none={{
              content: (
                <TargetSlot>
                  <span className="text-muted-foreground">
                    {t("historyFilterNone")}
                  </span>
                </TargetSlot>
              ),
              testId: `${testId}-none`,
              onSelect: () => select(null),
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 的の指定。未指定なら「指定なし」、指定済みなら的の表示を、同じ大きさの領域に出す。押すと選び直し、または外す。ボタンの名前は呼び出し側の`label`が与え、指定の状態は説明で伝える。
export function TargetFaceSelection({
  testId,
  targetFaceId,
  targetFaces,
  filter,
  onSelect,
}: {
  testId: string;
  targetFaceId: string | null;
  targetFaces: TargetFaceOption[];
  filter: TargetFilter;
  onSelect: (id: string | null) => void;
}) {
  const t = useTranslations("rounds");
  const describe = useTargetFaceLabel();
  const selected =
    targetFaceId === null ? null : lookupTargetFace(targetFaces, targetFaceId);
  return (
    <TargetFaceChoice
      testId={testId}
      selectedId={targetFaceId}
      targetFaces={targetFaces}
      filter={filter}
      onSelect={onSelect}
      description={
        selected === null
          ? t("targetFaceTriggerNone")
          : targetFaceTriggerLabel(t, describe, selected, false)
      }
    >
      <TargetSlot>
        {selected === null ? (
          <span className="text-muted-foreground">
            {t("historyFilterNone")}
          </span>
        ) : (
          <TargetFaceInfo face={selected} />
        )}
      </TargetSlot>
    </TargetFaceChoice>
  );
}

// 保存済みの的の一覧。表示の開始後に読み、無ければ空の一覧とする。
export function useSavedTargetFaces(): TargetFaceOption[] {
  const { fetching } = useRoundProcedures();
  const [targetFaces, setTargetFaces] = useState<TargetFaceOption[]>([]);
  useEffect(() => {
    setTargetFaces(fetching.savedTargetFaces() ?? []);
  }, [fetching]);
  return targetFaces;
}

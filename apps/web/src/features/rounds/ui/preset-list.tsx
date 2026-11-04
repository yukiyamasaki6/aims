"use client";

import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { type Preset, presetDistancesInOrder } from "../domain/preset";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { PresetInfo } from "./preset-info";
import { Skeleton } from "./skeleton";

// 読み込み後の2つの節と同じ形にする（見出し20px、個人プリセットの案内1行20px、
// 公式プリセット行50px、間隔gap-2/gap-4）。
export function PresetListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24 rounded" />
        <Skeleton className="h-5 w-3/4 rounded" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24 rounded" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[50px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function PresetRow({
  preset,
  selected,
  onSelect,
  onDelete,
}: {
  preset: Preset;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("rounds");
  const distances = presetDistancesInOrder(preset);

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card text-card-foreground shadow-sm",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      {/* このrelativeは名前行だけの高さに絞るためのもの。カード全体（外側の
          relative）に対して中央寄せすると、選択中の展開表示（下の
          PresetInfo）を含んだ高さで中央が計算され、展開時にメニュー
          ボタンの位置がずれてしまう。 */}
      <div className="relative">
        <button
          type="button"
          aria-pressed={selected}
          data-testid="round-preset-button"
          onClick={onSelect}
          className={cn(
            "w-full p-3 text-left font-medium",
            onDelete && "pr-10",
          )}
        >
          {preset.name}
        </button>
        {onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("presetMenuLabel", { name: preset.name })}
              data-testid="round-preset-menu-trigger"
              className="-translate-y-1/2 absolute top-1/2 right-1 p-2 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                data-testid="round-preset-delete"
                className="text-destructive data-[highlighted]:text-destructive"
                onClick={onDelete}
              >
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {selected && (
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full flex-col gap-1 border-t px-3 py-2 text-left text-muted-foreground text-sm"
        >
          <PresetInfo
            format={preset.format}
            bowType={preset.bow_type}
            distances={distances.map((d) => ({
              key: d.id,
              distance: d.distance,
              isMarked: d.is_marked,
              face: d.target_faces ?? "missing",
              arrowsPerEnd: d.arrows_per_end,
              totalEnds: d.total_ends,
            }))}
          />
        </button>
      )}
    </div>
  );
}

// 個人プリセットと公式プリセットの2つの節。
export function PresetSections({
  personalPresets,
  globalPresets,
  selectedId,
  onToggle,
  onDelete,
}: {
  personalPresets: Preset[];
  globalPresets: Preset[];
  selectedId: string | null;
  onToggle: (id: string) => void;
  onDelete: (preset: Preset) => void;
}) {
  const t = useTranslations("rounds");
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("presetPersonal")}</span>
        {personalPresets.length === 0 ? (
          <p
            data-testid="personal-preset-placeholder"
            className="text-muted-foreground text-sm"
          >
            {t("presetPersonalEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {personalPresets.map((preset) => (
              <PresetRow
                key={preset.id}
                preset={preset}
                selected={selectedId === preset.id}
                onSelect={() => onToggle(preset.id)}
                onDelete={() => onDelete(preset)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("presetGlobal")}</span>
        <div className="flex flex-col gap-2">
          {globalPresets.map((preset) => (
            <PresetRow
              key={preset.id}
              preset={preset}
              selected={selectedId === preset.id}
              onSelect={() => onToggle(preset.id)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

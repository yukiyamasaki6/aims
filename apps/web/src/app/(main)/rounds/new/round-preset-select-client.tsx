"use client";

import { ChevronLeft, Loader2, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { FetchView } from "@/features/fetch-result/fetch-result";
import { FetchState } from "@/features/fetch-result/fetch-state";
import { useFetchResult } from "@/features/fetch-result/use-fetch-result";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { comparePositionKey } from "../_shared/position-key";
import { PresetInfo } from "../_shared/preset-info";
import { type FetchedPresets, fetchPresets } from "./fetch-presets";
import type { Preset } from "./preset-types";
import { usePresetDelete } from "./use-preset-delete";
import { useStartRound } from "./use-start-round";

// 読み込み後の2つの節と同じ形にする（見出し20px、個人プリセットの案内1行20px、
// 公式プリセット行50px、間隔gap-2/gap-4）。
function PresetListSkeleton() {
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
  const distances = [...preset.preset_distances].sort((a, b) =>
    comparePositionKey(a.position_key, a.id, b.position_key, b.id),
  );

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
              aria-label={`「${preset.name}」のメニュー`}
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
                削除
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

// 取得できたプリセットのうち、表示するもの。削除済みの個人プリセットは除く。
function visiblePresets(view: FetchView<FetchedPresets>, removedIds: string[]) {
  if (view.status !== "ok") return { personalPresets: [], globalPresets: [] };
  return {
    personalPresets: view.data.personal.filter(
      (p) => !removedIds.includes(p.id),
    ),
    globalPresets: view.data.global,
  };
}

export function RoundPresetSelect() {
  const { view, retry } = useFetchResult(
    () => fetchPresets(createClient()),
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mountedRef = useMountedRef();
  const hydrated = useHydrated();
  const { removedIds, presetToDelete, setPresetToDelete, confirmDelete } =
    usePresetDelete(mountedRef, (presetId) =>
      setSelectedId((prev) => (prev === presetId ? null : prev)),
    );

  const { personalPresets, globalPresets } = visiblePresets(view, removedIds);
  const selectedPreset =
    [...personalPresets, ...globalPresets].find((p) => p.id === selectedId) ??
    null;
  const { error, submitting, handleStart } = useStartRound(
    selectedPreset,
    mountedRef,
  );

  function toggleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <main
      data-hydrated={hydrated}
      className="flex h-full flex-col overflow-hidden"
    >
      <PageHeader />

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 overflow-y-auto px-8 py-4">
        {view.status === "ok" ? (
          <PresetSections
            personalPresets={personalPresets}
            globalPresets={globalPresets}
            selectedId={selectedId}
            onToggle={toggleSelect}
            onDelete={setPresetToDelete}
          />
        ) : (
          <FetchState
            view={view}
            onRetry={retry}
            loading={<PresetListSkeleton />}
          />
        )}
      </div>

      <StartBar
        error={error}
        submitting={submitting}
        selectedPreset={selectedPreset}
        onStart={handleStart}
      />

      <DeletePresetDialog
        preset={presetToDelete}
        onClose={() => setPresetToDelete(null)}
        onConfirm={confirmDelete}
      />
    </main>
  );
}

// 個人プリセットと公式プリセットの2つの節。
function PresetSections({
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
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">個人プリセット</span>
        {personalPresets.length === 0 ? (
          <p
            data-testid="personal-preset-placeholder"
            className="text-muted-foreground text-sm"
          >
            プリセットとして保存すると、ここに表示されます。
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
        <span className="text-sm font-medium">公式プリセット</span>
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

function StartBar({
  error,
  submitting,
  selectedPreset,
  onStart,
}: {
  error: string | null;
  submitting: boolean;
  selectedPreset: Preset | null;
  onStart: () => void;
}) {
  return (
    <div className="border-t bg-card shadow-lg">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2 p-4">
        {error && <p className="text-destructive text-sm">{error}</p>}
        <p className="text-center font-medium text-sm">
          種別・弓種・距離は開始後に変更可能です。
        </p>
        <Button
          type="button"
          aria-disabled={submitting}
          data-testid="round-start-button"
          className={cn(submitting && "pointer-events-none opacity-50")}
          onClick={onStart}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          {selectedPreset
            ? `「${selectedPreset.name}」で開始`
            : "プリセット無しで開始"}
        </Button>
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="mx-auto w-full max-w-xl px-8 pt-8">
      <Link
        href="/rounds"
        className="mb-2 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        一覧へ戻る
      </Link>
      <h1 className="font-heading text-2xl leading-snug font-medium">
        ラウンドを作成
      </h1>
    </div>
  );
}

function DeletePresetDialog({
  preset,
  onClose,
  onConfirm,
}: {
  preset: Preset | null;
  onClose: () => void;
  onConfirm: () => Promise<{ error: string } | undefined>;
}) {
  return (
    <BlockingConfirmDialog
      open={preset !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      description={`「${preset?.name}」を削除しますか？`}
      onConfirm={onConfirm}
    />
  );
}

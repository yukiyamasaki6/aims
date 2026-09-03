"use client";

import { ChevronLeft, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useState } from "react";
import type { TargetFaceRing } from "@/components/target-face-icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PresetInfo } from "../[id]/distance-config-row";
import {
  createCustomRound,
  createRoundFromPreset,
  deletePreset,
} from "./actions";

type PresetDistance = {
  distance_number: number;
  distance: number | null;
  is_marked: boolean;
  total_ends: number;
  arrows_per_end: number;
  target_faces: {
    size: number;
    target_face_spots: {
      center_x: number;
      center_y: number;
      target_face_rings: TargetFaceRing[];
    }[];
  } | null;
};

export type Preset = {
  id: string;
  name: string;
  format: string;
  bow_type: string;
  round_preset_distances: PresetDistance[];
};

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
  const distances = [...preset.round_preset_distances].sort(
    (a, b) => a.distance_number - b.distance_number,
  );

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card text-card-foreground shadow-sm",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        data-testid="round-preset-button"
        onClick={onSelect}
        className={cn("w-full p-3 text-left font-medium", onDelete && "pr-10")}
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
              key: d.distance_number,
              distance: d.distance,
              isMarked: d.is_marked,
              face: d.target_faces,
              arrowsPerEnd: d.arrows_per_end,
              totalEnds: d.total_ends,
            }))}
          />
        </button>
      )}
    </div>
  );
}

export function RoundPresetSelect({
  personalPresets: initialPersonalPresets,
  globalPresets,
}: {
  personalPresets: Preset[];
  globalPresets: Preset[];
}) {
  const [personalPresets, setPersonalPresets] = useState(
    initialPersonalPresets,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [presetToDelete, setPresetToDelete] = useState<Preset | null>(null);

  const selectedPreset =
    [...personalPresets, ...globalPresets].find((p) => p.id === selectedId) ??
    null;

  function toggleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  async function performDeletePreset(preset: Preset) {
    const result = await deletePreset(preset.id);
    if (result?.error) {
      setError(result.error);
      return;
    }

    setPersonalPresets((prev) => prev.filter((p) => p.id !== preset.id));
    setSelectedId((prev) => (prev === preset.id ? null : prev));
  }

  async function handleStart() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      const result = selectedId
        ? await createRoundFromPreset(selectedId)
        : await createCustomRound();
      if (result?.error) {
        setError(result.error);
      }
    } catch (e) {
      // redirect()はNext.js内部的にNEXT_REDIRECT例外をthrowして遷移を実行するため、
      // ここで握りつぶさず再送出する。
      unstable_rethrow(e);
      setError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex h-full flex-col overflow-hidden">
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

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 overflow-y-auto px-8 py-4">
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
                  onSelect={() => toggleSelect(preset.id)}
                  onDelete={() => setPresetToDelete(preset)}
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
                onSelect={() => toggleSelect(preset.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="border-t bg-card shadow-lg">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-2 p-4">
          {error && <p className="text-destructive text-sm">{error}</p>}
          <p className="text-center font-medium text-sm">
            種別・弓種・距離は開始後に変更可能です。
          </p>
          <Button
            type="button"
            disabled={submitting}
            data-testid="round-start-button"
            onClick={handleStart}
          >
            {selectedPreset
              ? `「${selectedPreset.name}」で開始`
              : "プリセット無しで開始"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={presetToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPresetToDelete(null);
        }}
        description={`「${presetToDelete?.name}」を削除しますか？`}
        onConfirm={() => {
          if (presetToDelete) performDeletePreset(presetToDelete);
        }}
      />
    </main>
  );
}

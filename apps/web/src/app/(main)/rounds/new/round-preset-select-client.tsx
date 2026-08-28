"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useState } from "react";
import {
  TargetFaceIcon,
  type TargetFaceRing,
} from "@/components/target-face-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createCustomRound, createRoundFromPreset } from "./actions";

type PresetDistance = {
  distance_number: number;
  distance: number;
  total_ends: number;
  arrows_per_end: number;
  target_faces: {
    target_face_spots: { target_face_rings: TargetFaceRing[] }[];
  } | null;
};

export type Preset = {
  id: string;
  name: string;
  round_preset_distances: PresetDistance[];
};

function PresetRow({
  preset,
  selected,
  onSelect,
}: {
  preset: Preset;
  selected: boolean;
  onSelect: () => void;
}) {
  const distances = [...preset.round_preset_distances].sort(
    (a, b) => a.distance_number - b.distance_number,
  );

  return (
    <div
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-sm",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        data-testid="round-preset-button"
        onClick={onSelect}
        className="w-full p-3 text-left font-medium"
      >
        {preset.name}
      </button>
      {selected && (
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full flex-col gap-1 border-t px-3 py-2 text-left text-muted-foreground text-sm"
        >
          {distances.map((d) => {
            const rings =
              d.target_faces?.target_face_spots[0]?.target_face_rings ?? [];
            const size =
              rings.length > 0
                ? Math.max(...rings.map((r) => r.radius)) * 2
                : null;

            return (
              <div
                key={d.distance_number}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2">
                  {d.distance}m
                  <TargetFaceIcon rings={rings} />
                  {size !== null ? `${size}cm` : "的未設定"}
                </span>
                <span className="shrink-0">
                  {d.arrows_per_end}本×{d.total_ends}エンド
                </span>
              </div>
            );
          })}
        </button>
      )}
    </div>
  );
}

export function RoundPresetSelect({
  personalPresets,
  globalPresets,
}: {
  personalPresets: Preset[];
  globalPresets: Preset[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedPreset =
    [...personalPresets, ...globalPresets].find((p) => p.id === selectedId) ??
    null;

  function toggleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
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
          <p className="text-center text-muted-foreground text-xs">
            開始後もラウンド構成は変更可能です。
          </p>
          <Button
            type="button"
            disabled={submitting}
            data-testid="round-start-button"
            onClick={handleStart}
          >
            {selectedPreset
              ? `「${selectedPreset.name}」で開始`
              : "カスタムで開始"}
          </Button>
        </div>
      </div>
    </main>
  );
}

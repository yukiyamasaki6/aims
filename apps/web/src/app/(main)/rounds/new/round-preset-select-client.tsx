"use client";

import { ChevronLeft, Loader2, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FetchState } from "@/features/fetch-result/fetch-state";
import { useFetchResult } from "@/features/fetch-result/use-fetch-result";
import { useHydrated } from "@/hooks/use-hydrated";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { comparePositionKey } from "../_shared/position-key";
import { PresetInfo } from "../_shared/preset-info";
import { deletePersonalPreset } from "./delete-preset";
import { fetchPresets } from "./fetch-presets";
import type { Preset } from "./preset-types";
import { startRound } from "./start-round";

// 読み込み後の2つの節と同じ形にする（見出し20px、個人プリセットの案内1行20px、
// 公式プリセット行50px、間隔gap-2/gap-4）。
function PresetListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[50px] animate-pulse rounded-xl bg-muted" />
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

export function RoundPresetSelect() {
  const router = useRouter();
  const { view, retry } = useFetchResult(
    () => fetchPresets(createClient()),
    [],
  );
  // 削除済みの個人プリセットは取得結果から除いて表示する。
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // 二重送信の判定は同期的なrefで行う。setSubmitting()由来のstateはレンダーを
  // 挟むまで更新されず、連打で2回目の呼び出しが古いsubmitting=falseの
  // クロージャのまま実行されてしまうため、stateだけでは防げない。
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [presetToDelete, setPresetToDelete] = useState<Preset | null>(null);
  const hydrated = useHydrated();

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に
    // 対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const personalPresets =
    view.status === "ok"
      ? view.data.personal.filter((p) => !removedIds.includes(p.id))
      : [];
  const globalPresets = view.status === "ok" ? view.data.global : [];
  const selectedPreset =
    [...personalPresets, ...globalPresets].find((p) => p.id === selectedId) ??
    null;

  function toggleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  async function performDeletePreset(
    preset: Preset,
  ): Promise<{ error: string } | undefined> {
    const result = await deletePersonalPreset({
      presetId: preset.id,
      isMounted: () => mountedRef.current,
    });
    if (result.status === "discarded") return;
    if (result.status === "failed") return { error: result.error };

    setRemovedIds((prev) => [...prev, preset.id]);
    setSelectedId((prev) => (prev === preset.id ? null : prev));
  }

  async function handleStart() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setSubmitting(true);

    const result = await startRound({
      presetId: selectedId,
      isMounted: () => mountedRef.current,
      generateId: () => crypto.randomUUID(),
      now: () => new Date(),
    });
    if (result.status === "discarded") return;

    if (result.status === "failed") {
      setError(result.error);
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    // 成功時はここでsubmittingを解除しない。router.push()は遷移先の取得中も
    // このコンポーネントを保持し続けるため、ここで解除すると遷移完了前に
    // ボタンが再度押せる状態に戻ってしまう。アンマウント時に自然に破棄される。
    router.push(`/rounds/${result.roundId}`);
  }

  return (
    <main
      data-hydrated={hydrated}
      className="flex h-full flex-col overflow-hidden"
    >
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
        {view.status === "ok" ? (
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
          </>
        ) : (
          <FetchState
            view={view}
            onRetry={retry}
            loading={<PresetListSkeleton />}
          />
        )}
      </div>

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
            onClick={handleStart}
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {selectedPreset
              ? `「${selectedPreset.name}」で開始`
              : "プリセット無しで開始"}
          </Button>
        </div>
      </div>

      <BlockingConfirmDialog
        open={presetToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPresetToDelete(null);
        }}
        description={`「${presetToDelete?.name}」を削除しますか？`}
        onConfirm={async () => {
          if (!presetToDelete) return;
          return performDeletePreset(presetToDelete);
        }}
      />
    </main>
  );
}

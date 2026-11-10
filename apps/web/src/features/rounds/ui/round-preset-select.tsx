"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import { withSaved } from "../domain/fetch-status";
import type { Preset, Presets } from "../domain/preset";
import { presetListView } from "../domain/preset-list-view";
import type { PresetDeleteFailure } from "../domain/write-result";
import { BackToListLink } from "./back-to-list-link";
import { FetchState } from "./fetch-state";
import { PresetListSkeleton, PresetSections } from "./preset-list";
import { useRoundProcedures } from "./rounds-context";
import { useFetchResult } from "./use-fetch-result";
import { usePresetDelete } from "./use-preset-delete";
import { useStartRound } from "./use-start-round";

export function RoundPresetSelect() {
  const { fetching, whenOnline } = useRoundProcedures();
  const { view: fetched, retry } = useFetchResult(
    () => fetching.fetchPresets(),
    whenOnline,
  );
  // 保存済みは描画の後に読む。初回の描画を静的な枠と同じにして、ハイドレーションの不一致を避けるため。
  const [saved, setSaved] = useState<Presets | null>(null);
  useEffect(() => setSaved(fetching.savedPresets()), [fetching]);
  const view = withSaved(fetched, saved);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mountedRef = useMountedRef();
  const hydrated = useHydrated();
  const { removedIds, setPresetToDelete, dialog } = usePresetDelete();

  const {
    personal: personalPresets,
    global: globalPresets,
    selected: selectedPreset,
  } = presetListView(view, removedIds, selectedId);
  const { unauthenticated, submitting, handleStart } = useStartRound(
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
        unauthenticated={unauthenticated}
        submitting={submitting}
        selectedPreset={selectedPreset}
        onStart={handleStart}
      />

      <DeletePresetDialog {...dialog} />
    </main>
  );
}

function StartBar({
  unauthenticated,
  submitting,
  selectedPreset,
  onStart,
}: {
  unauthenticated: boolean;
  submitting: boolean;
  selectedPreset: Preset | null;
  onStart: () => void;
}) {
  const t = useTranslations("rounds");
  return (
    <div className="border-t bg-card shadow-lg">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2 p-4">
        {unauthenticated && (
          <p className="text-destructive text-sm">
            {t("roundStartUnauthenticated")}
          </p>
        )}
        <p className="text-center font-medium text-sm">{t("startNotice")}</p>
        <BusyButton
          type="button"
          busy={submitting}
          data-testid="round-start-button"
          onClick={onStart}
        >
          {selectedPreset
            ? t("startWithPreset", { name: selectedPreset.name })
            : t("startWithoutPreset")}
        </BusyButton>
      </div>
    </div>
  );
}

function PageHeader() {
  const t = useTranslations("rounds");
  return (
    <div className="mx-auto w-full max-w-xl px-8 pt-8">
      <BackToListLink className="mb-2" />
      <h1 className="font-heading text-2xl leading-snug font-medium">
        {t("createRound")}
      </h1>
    </div>
  );
}

function DeletePresetDialog({
  preset,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  preset: Preset | null;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: PresetDeleteFailure | null;
}) {
  const t = useTranslations("rounds");
  return (
    <BlockingConfirmDialog
      open={preset !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      description={t("presetDeleteConfirm", { name: preset?.name ?? "" })}
      onConfirm={onConfirm}
      busy={busy}
      error={error && t(`presetDeleteFailure.${error}`)}
    />
  );
}

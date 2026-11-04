"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { generatePresetName } from "../domain/preset-save";
import { compareDistancePosition } from "../domain/scorecard-scoring";
import type { Distance } from "../domain/scorecard-types";
import { lookupTargetFace, type TargetFaceOption } from "../domain/target-face";
import { PresetInfo } from "./preset-info";
import { useRoundDetailStore } from "./rounds-context";
import {
  CLOSED_PRESET_DIALOG,
  changePresetDialogOpen,
  finishPresetSave,
  type PresetDialogState,
  startPresetSave,
} from "./save-preset-dialog-state";

export function SavePresetDialog({
  roundName,
  format,
  bowType,
  distances,
  targetFaces,
}: {
  roundName: string;
  format: string;
  bowType: string;
  distances: Distance[];
  targetFaces: TargetFaceOption[];
}) {
  const t = useTranslations("rounds");
  const store = useRoundDetailStore();
  const [state, setState] = useState(CLOSED_PRESET_DIALOG);

  async function handleSave() {
    const start = startPresetSave(state, { format, bowType, distances });
    if (start.type === "busy") return;
    setState(start.state);
    if (start.type === "invalid") return;

    const result = await store.savePreset(start.preset);
    setState((prev) => finishPresetSave(prev, result));
  }

  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) =>
        setState((prev) => changePresetDialogOpen(prev, open, roundName))
      }
    >
      <DialogTrigger
        data-testid="save-as-preset-trigger"
        className={buttonVariants({ variant: "default", size: "sm" })}
      >
        {t("presetSaveTrigger")}
      </DialogTrigger>
      <DialogContent>
        <PresetDialogBody
          state={state}
          setState={setState}
          format={format}
          bowType={bowType}
          distances={distances}
          targetFaces={targetFaces}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
}

function PresetDialogBody({
  state,
  setState,
  format,
  bowType,
  distances,
  targetFaces,
  onSave,
}: {
  state: PresetDialogState;
  setState: Dispatch<SetStateAction<PresetDialogState>>;
  format: string;
  bowType: string;
  distances: Distance[];
  targetFaces: TargetFaceOption[];
  onSave: () => void;
}) {
  const t = useTranslations("rounds");
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-medium text-sm">{t("presetSaveTitle")}</h2>
      <PresetInfo
        format={format}
        bowType={bowType}
        distances={[...distances].sort(compareDistancePosition).map((d) => ({
          key: d.id,
          distance: d.distance,
          isMarked: d.is_marked,
          face: lookupTargetFace(targetFaces, d.target_face_id),
          arrowsPerEnd: d.arrows_per_end,
          totalEnds: d.total_ends,
        }))}
      />
      <div className="flex flex-col gap-1">
        <label
          htmlFor="save-as-preset-name"
          className="text-muted-foreground text-xs"
        >
          {t("presetName")}
        </label>
        <Input
          id="save-as-preset-name"
          data-testid="save-as-preset-name"
          placeholder={generatePresetName(distances)}
          value={state.name}
          onChange={(e) => {
            const name = e.target.value;
            setState((prev) => ({ ...prev, name }));
          }}
          aria-invalid={Boolean(state.error)}
        />
        {state.error && (
          <p className="text-destructive text-sm">
            {t(`presetSaveFailure.${state.error}`)}
          </p>
        )}
      </div>
      <Button
        type="button"
        aria-disabled={state.submitting}
        className={cn(state.submitting && "pointer-events-none opacity-50")}
        data-testid="save-as-preset-confirm"
        onClick={onSave}
      >
        {state.submitting && <Loader2 className="size-3.5 animate-spin" />}
        {t("save")}
      </Button>
    </div>
  );
}

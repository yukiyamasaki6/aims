"use client";

import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { generatePresetName } from "../domain/preset-save";
import { compareDistancePosition } from "../domain/scorecard-scoring";
import type { Distance } from "../domain/scorecard-types";
import { lookupTargetFace, type TargetFaceOption } from "../domain/target-face";
import { PresetInfo } from "./preset-info";
import { useRoundProcedures } from "./rounds-context";
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
  const { presetSaving } = useRoundProcedures();
  const [state, setState] = useState(CLOSED_PRESET_DIALOG);

  async function handleSave() {
    const start = startPresetSave(state, { format, bowType, distances });
    if (start.type === "busy") return;
    setState(start.state);
    if (start.type === "invalid") return;

    const result = await presetSaving.savePreset(start.preset);
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
  // 距離がないときは、押す前から理由を示し、保存を押せなくする。
  const noDistances = distances.length === 0;
  const shown = noDistances ? "noDistances" : state.error;
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
          aria-invalid={Boolean(shown)}
        />
        {shown && (
          <p className="text-destructive text-sm">
            {t(`presetSaveFailure.${shown}`)}
          </p>
        )}
      </div>
      <BusyButton
        type="button"
        busy={state.submitting}
        disabled={noDistances}
        data-testid="save-as-preset-confirm"
        onClick={onSave}
      >
        {t("save")}
      </BusyButton>
    </div>
  );
}

"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PresetInfo } from "../_shared/preset-info";
import type { TargetFaceOption } from "./distance-config-row";
import {
  CLOSED_PRESET_DIALOG,
  changePresetDialogOpen,
  finishPresetSave,
  generatePresetName,
  type SaveRoundAsPresetArgs,
  startPresetSave,
} from "./scorecard-preset";
import { compareDistancePosition } from "./scorecard-scoring";
import type { Distance } from "./scorecard-types";

async function saveRoundAsPreset(
  args: SaveRoundAsPresetArgs,
): Promise<{ error: string } | undefined> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  // プリセット作成・距離複製は、Postgres関数（save_round_as_preset）内で1つのトランザクションとして行う。
  // 距離のinsertが失敗しても、距離を持たない空のプリセットが残ることはない。
  const { error } = await supabase.rpc("save_round_as_preset", args);

  if (error) {
    return { error: error.message };
  }
}

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
  const [state, setState] = useState(CLOSED_PRESET_DIALOG);

  async function handleSave() {
    const start = startPresetSave(state, { format, bowType, distances });
    if (start.type === "busy") return;
    setState(start.state);
    if (start.type === "invalid") return;

    const result = await saveRoundAsPreset(start.args);
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
        プリセット保存
      </DialogTrigger>
      <DialogContent>
        <div className="flex flex-col gap-3">
          <h2 className="font-medium text-sm">
            現在の構成をプリセットとして保存しますか？
          </h2>
          <PresetInfo
            format={format}
            bowType={bowType}
            distances={[...distances]
              .sort(compareDistancePosition)
              .map((d) => ({
                key: d.id,
                distance: d.distance,
                isMarked: d.is_marked,
                face:
                  targetFaces.find((f) => f.id === d.target_face_id) ?? null,
                arrowsPerEnd: d.arrows_per_end,
                totalEnds: d.total_ends,
              }))}
          />
          <div className="flex flex-col gap-1">
            <label
              htmlFor="save-as-preset-name"
              className="text-muted-foreground text-xs"
            >
              プリセット名
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
              <p className="text-destructive text-sm">{state.error}</p>
            )}
          </div>
          <Button
            type="button"
            aria-disabled={state.submitting}
            className={cn(state.submitting && "pointer-events-none opacity-50")}
            data-testid="save-as-preset-confirm"
            onClick={handleSave}
          >
            {state.submitting && <Loader2 className="size-3.5 animate-spin" />}
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

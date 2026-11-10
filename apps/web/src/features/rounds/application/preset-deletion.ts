import type { SessionReader } from "@/features/auth";
import { signInFailure } from "../domain/fetch-status";
import { type Presets, withoutPreset } from "../domain/preset";
import type { PresetDeleteFailure } from "../domain/write-result";
import type { PresetCommands } from "./preset-commands";
import type { ReferenceSnapshots } from "./reference-snapshots";

// deleted: 削除した。
// failed: 削除できず、失敗の種類がある。
// discarded: 完了を待つ間に、結果を受け取る画面が無くなった。
type PresetDeletionResult =
  | { status: "deleted" }
  | { status: "failed"; error: PresetDeleteFailure }
  | { status: "discarded" };

export type PresetDeletion = {
  deletePreset(
    presetId: string,
    isCurrent: () => boolean,
  ): Promise<PresetDeletionResult>;
};

// 確認の後に呼ぶ個人プリセットの削除。成功したら保存済みからも除く。
export function createPresetDeletion(deps: {
  sessionReader: SessionReader;
  commands: Pick<PresetCommands, "deletePreset">;
  snapshots: ReferenceSnapshots;
}): PresetDeletion {
  const { sessionReader, commands, snapshots } = deps;

  return {
    async deletePreset(presetId, isCurrent) {
      const reading = await sessionReader.readSession();
      if (!isCurrent()) return { status: "discarded" };
      if (reading.status !== "authenticated") {
        return { status: "failed", error: signInFailure(reading.status) };
      }

      const result = await commands.deletePreset(presetId);
      // 書き込みに成功したら、画面を離れていても保存済みから除く。保存済みはサーバーの事実の写しで、破棄は画面に結果を出さないことだけを意味する。届かなかったときと拒否されたときは変えない。
      if (result === "written") {
        snapshots.update<Presets>("presets", (presets) =>
          withoutPreset(presets, presetId),
        );
      }
      if (!isCurrent()) return { status: "discarded" };
      if (result !== "written") {
        return { status: "failed", error: "deleteFailed" };
      }
      return { status: "deleted" };
    },
  };
}

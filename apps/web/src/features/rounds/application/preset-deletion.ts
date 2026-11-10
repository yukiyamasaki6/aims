import type { SessionReader } from "@/features/auth";
import { type Presets, withoutPreset } from "../domain/preset";
import type { PresetDeleteFailure } from "../domain/write-result";
import type { PresetCommands } from "./preset-commands";
import type { ReferenceSnapshots } from "./reference-snapshots";

// deleted: 削除した。
// failed: 削除できず、失敗の種類がある。
type PresetDeletionResult =
  | { status: "deleted" }
  | { status: "failed"; error: PresetDeleteFailure };

export type PresetDeletion = {
  deletePreset(presetId: string): Promise<PresetDeletionResult>;
};

// 確認の後に呼ぶ個人プリセットの削除。未認証のときだけ止め、サインインを確かめられない(不明)ときは書き込みへ進む。成功したら保存済みからも除く。
export function createPresetDeletion(deps: {
  sessionReader: SessionReader;
  commands: Pick<PresetCommands, "deletePreset">;
  snapshots: ReferenceSnapshots;
}): PresetDeletion {
  const { sessionReader, commands, snapshots } = deps;

  return {
    async deletePreset(presetId) {
      const reading = await sessionReader.readSession();
      if (reading.status === "unauthenticated") {
        return { status: "failed", error: "unauthenticated" };
      }

      const result = await commands.deletePreset(presetId);
      // 書き込みに成功したら保存済みから除く。画面を離れていても完了する。書き込めなかったときは変えない。
      if (result !== "written") {
        return { status: "failed", error: "deleteFailed" };
      }
      snapshots.update<Presets>("presets", (presets) =>
        withoutPreset(presets, presetId),
      );
      return { status: "deleted" };
    },
  };
}

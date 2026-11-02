import { type Presets, withoutPreset } from "../domain/preset";
import { PRESET_DELETE_ERROR_MESSAGE } from "../domain/write-result";
import type { PresetCommands } from "./preset-commands";
import type { ReferenceSnapshots } from "./reference-snapshots";
import type { SignInReader } from "./sign-in-reader";

// deleted: 削除した。
// failed: 削除できず、画面に出す文言がある。
// discarded: 完了を待つ間に、結果を受け取る画面が無くなった。
export type DeletePresetResult =
  | { status: "deleted" }
  | { status: "failed"; error: string }
  | { status: "discarded" };

export type PresetDeletion = {
  deletePreset(
    presetId: string,
    isCurrent: () => boolean,
  ): Promise<DeletePresetResult>;
};

// 確認の後に呼ぶ個人プリセットの削除。成功したら保存済みからも除く。
export function createPresetDeletion(deps: {
  signIn: SignInReader;
  commands: Pick<PresetCommands, "deletePreset">;
  snapshots: ReferenceSnapshots;
}): PresetDeletion {
  const { signIn, commands, snapshots } = deps;

  return {
    async deletePreset(presetId, isCurrent) {
      const reading = await signIn.read();
      if (!isCurrent()) return { status: "discarded" };
      if (reading.status !== "authenticated") {
        return { status: "failed", error: reading.message };
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
        return { status: "failed", error: PRESET_DELETE_ERROR_MESSAGE };
      }
      return { status: "deleted" };
    },
  };
}

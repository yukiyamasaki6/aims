import type { SessionReader } from "@/features/auth";
import type { Clock } from "@/lib/clock/contract/clock";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import { type Presets, withoutPreset } from "../domain/preset";
import type { PresetDeleteFailure } from "../domain/write-result";
import type { PresetCommands } from "./preset-commands";
import type { ReferenceSnapshots } from "./reference-snapshots";
import { TIMED_OUT, withinTimeUnless } from "./time-limit";

// deleted: 削除した。
// failed: 削除できず、失敗の種類がある。
type PresetDeletionResult =
  | { status: "deleted" }
  | { status: "failed"; error: PresetDeleteFailure };

export type PresetDeletion = {
  deletePreset(presetId: string): Promise<PresetDeletionResult>;
};

// 確認の後に呼ぶ個人プリセットの削除。未認証のときだけ止め、サインインを確かめられない(不明)ときは書き込みへ進む。成功したら保存済みからも除く。
// 手続きの全体(サインインの確認と書き込み)をFETCH_TIMEOUT_MSで打ち切り、超えたら失敗にする。打ち切った後に遅れて進む続きは、書き込みにも保存済みの更新にも進まない。書き込みの送信後に時間切れになった場合は止められず、書き込みが成立しても保存済みには次の取得まで残る。
export function createPresetDeletion(deps: {
  sessionReader: SessionReader;
  commands: Pick<PresetCommands, "deletePreset">;
  snapshots: ReferenceSnapshots;
  clock: Clock;
}): PresetDeletion {
  const { sessionReader, commands, snapshots, clock } = deps;
  const failed = { status: "failed", error: "deleteFailed" } as const;

  async function remove(
    presetId: string,
    expired: () => boolean,
  ): Promise<PresetDeletionResult> {
    const reading = await sessionReader.readSession();
    if (expired()) return failed;
    if (reading.status === "unauthenticated") {
      return { status: "failed", error: "unauthenticated" };
    }

    const result = await commands.deletePreset(presetId);
    // 書き込みに成功したら保存済みから除く。画面を離れていても完了する。書き込めなかったとき、打ち切った後は変えない。
    if (result !== "written" || expired()) return failed;
    snapshots.update<Presets>("presets", (presets) =>
      withoutPreset(presets, presetId),
    );
    return { status: "deleted" };
  }

  return {
    async deletePreset(presetId) {
      const outcome = await withinTimeUnless(
        clock,
        FETCH_TIMEOUT_MS,
        (expired) => remove(presetId, expired),
      );
      return outcome === TIMED_OUT ? failed : outcome;
    },
  };
}

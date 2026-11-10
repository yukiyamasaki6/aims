import type { SessionReader } from "@/features/auth";
import type { Clock } from "@/lib/clock/contract/clock";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import type { PresetToSave } from "../domain/preset-save";
import type { PresetSaveFailure } from "../domain/write-result";
import type { PresetCommands } from "./preset-commands";
import type { RoundFetching } from "./round-fetching";
import { TIMED_OUT, withinTimeUnless } from "./time-limit";

// saved: 保存した。
// failed: 保存できず、失敗の種類がある。
export type PresetSavingResult =
  | { status: "saved" }
  | { status: "failed"; error: PresetSaveFailure };

export type PresetSaving = {
  savePreset(preset: PresetToSave): Promise<PresetSavingResult>;
};

// 現在の構成をプリセットとして保存する。未認証のときだけ止め、サインインを確かめられない(不明)ときは書き込みへ進む。書き込めなければ失敗にする。成功したら保存済みの背景を取り直す。
// 手続きの全体(サインインの確認と書き込み)をFETCH_TIMEOUT_MSで打ち切り、超えたら失敗にする。打ち切った後に遅れて進む続きは、書き込みにも背景更新にも進まない。書き込みの送信後に時間切れになった場合は止められず、失敗の表示の後に保存が成立し得る。
// 例外: 通信と拒否は結果で返す。接続を得られない設定の誤りのときは投げる(想定外)。
export function createPresetSaving(deps: {
  sessionReader: SessionReader;
  commands: Pick<PresetCommands, "savePreset">;
  fetching: Pick<RoundFetching, "fetchPresets">;
  clock: Clock;
}): PresetSaving {
  const { sessionReader, commands, fetching, clock } = deps;
  const failed = { status: "failed", error: "saveFailed" } as const;

  async function save(
    preset: PresetToSave,
    expired: () => boolean,
  ): Promise<PresetSavingResult> {
    const reading = await sessionReader.readSession();
    if (expired()) return failed;
    if (reading.status === "unauthenticated") {
      return { status: "failed", error: "unauthenticated" };
    }

    const result = await commands.savePreset(preset);
    if (result !== "written") return failed;
    if (expired()) return failed;

    // 保存済みのプリセットを背景で更新する(結果は使わない)。
    void fetching.fetchPresets();
    return { status: "saved" };
  }

  return {
    async savePreset(preset) {
      const outcome = await withinTimeUnless(
        clock,
        FETCH_TIMEOUT_MS,
        (expired) => save(preset, expired),
      );
      return outcome === TIMED_OUT ? failed : outcome;
    },
  };
}

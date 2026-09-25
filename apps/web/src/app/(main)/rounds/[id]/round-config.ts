import { NAME_MAX_LENGTH } from "../_shared/round-constants";
import type { EnqueueInput } from "./sync-queue-types";

export type RoundConfig = {
  name: string;
  roundDate: string;
  format: string;
  bowType: string;
};

export type RoundConfigErrors = {
  name?: string;
  roundDate?: string;
  format?: string;
};

export type RoundConfigValidation =
  | { type: "valid"; config: RoundConfig }
  | { type: "invalid"; errors: RoundConfigErrors };

// クライアントが既に持っている値（distancesのis_marked）だけで判定できるため、サーバーへ投げる前に同期的に検証する。
// キュー経由の非同期エラーにはしない。
export function validateRoundConfig(
  draft: RoundConfig,
  hasUnmarkedDistances: boolean,
): RoundConfigValidation {
  const errors: RoundConfigErrors = {};
  if (draft.name.length > NAME_MAX_LENGTH) {
    errors.name = `ラウンド名は${NAME_MAX_LENGTH}文字以内で入力してください。`;
  }
  if (draft.roundDate === "") {
    errors.roundDate = "実施日を入力してください。";
  }
  if (draft.format !== "field" && hasUnmarkedDistances) {
    errors.format =
      "Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。";
  }
  if (Object.keys(errors).length > 0) {
    return { type: "invalid", errors };
  }
  return { type: "valid", config: draft };
}

export function buildRoundUpdatedInput(
  roundId: string,
  config: RoundConfig,
  eventId: string,
): EnqueueInput {
  return {
    key: "roundConfig",
    label: "ラウンド設定",
    operation: {
      type: "round.updated",
      eventId,
      roundId,
      name: config.name,
      roundDate: config.roundDate,
      format: config.format,
      bowType: config.bowType,
    },
  };
}

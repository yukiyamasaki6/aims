import { NAME_MAX_LENGTH } from "../_shared/round-constants";
import type { RoundChanges, SyncOperation } from "../_shared/sync-events";

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
// 送信後の非同期エラーにはしない。
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

// 保存した値と表示中の値の差分を、操作として返す。差分が無ければ操作を積まない。
export function buildRoundUpdatedOperation(
  roundId: string,
  saved: RoundConfig,
  config: RoundConfig,
  eventId: string,
): SyncOperation | null {
  const changes: RoundChanges = {};
  if (config.name !== saved.name) changes.name = config.name;
  if (config.roundDate !== saved.roundDate) {
    changes.roundDate = config.roundDate;
  }
  if (config.format !== saved.format) changes.format = config.format;
  if (config.bowType !== saved.bowType) changes.bowType = config.bowType;
  if (Object.keys(changes).length === 0) return null;
  return { type: "round.updated", eventId, roundId, changes };
}

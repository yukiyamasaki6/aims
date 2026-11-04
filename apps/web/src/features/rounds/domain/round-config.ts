import { NAME_MAX_LENGTH } from "./round-constants";
import type { RoundChanges, SyncOperation } from "./sync-events";

export type RoundConfig = {
  name: string;
  roundDate: string;
  format: string;
  bowType: string;
};

// 入力の誤りの種類。tooLong: 上限を超える。required: 未入力。unmarkedDistances: Unmarkedの距離が残っている。
export type RoundConfigError = "tooLong" | "required" | "unmarkedDistances";
export type RoundConfigErrors = {
  name?: Extract<RoundConfigError, "tooLong">;
  roundDate?: Extract<RoundConfigError, "required">;
  format?: Extract<RoundConfigError, "unmarkedDistances">;
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
    errors.name = "tooLong";
  }
  if (draft.roundDate === "") {
    errors.roundDate = "required";
  }
  if (draft.format !== "field" && hasUnmarkedDistances) {
    errors.format = "unmarkedDistances";
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

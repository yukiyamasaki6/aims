import { sessionFailureMessage } from "@/features/auth/errors";
import {
  classifySession,
  type SessionState,
} from "@/features/auth/session-state";
import { createClient } from "@/lib/supabase/client";
import { comparePositionKey } from "../_shared/position-key";
import { roundOpHub } from "../[id]/round-op-hub";
import { roundStreamId } from "../[id]/round-op-store";
import type { SyncOperation } from "../[id]/sync-events";
import type { Preset } from "./preset-types";

// 認証の確認で通信を待つ上限。アクセストークンが有効なら通信しないため、待つのは失効時だけ。
export const SESSION_CHECK_TIMEOUT_MS = 1000;

type CreatedOperation = Extract<SyncOperation, { type: "round.created" }>;

// created: ラウンドの作成を端末の操作の列へ保存した。送信は常駐の送信器が行う。
// failed: 開始できず、画面に表示するエラーメッセージがある。
// discarded: 認証の確認を待つ間に画面がアンマウントされたため、結果を破棄した。
type StartRoundResult =
  | { status: "created"; roundId: string }
  | { status: "failed"; error: string }
  | { status: "discarded" };

// プリセットの距離をposition_key順に並べ、新しいIDを振ったラウンドの距離へ変換する。
function toRoundDistances(
  presetDistances: Preset["preset_distances"],
  generateId: () => string,
): CreatedOperation["distances"] {
  return [...presetDistances]
    .sort((a, b) =>
      comparePositionKey(a.position_key, a.id, b.position_key, b.id),
    )
    .map((d) => ({
      eventId: generateId(),
      id: generateId(),
      positionKey: d.position_key,
      distance: d.distance,
      isMarked: d.is_marked,
      totalEnds: d.total_ends,
      arrowsPerEnd: d.arrows_per_end,
      targetFaceId: d.target_face_id,
    }));
}

// 作成の操作を組み立てる。
// プリセットを選択していない場合は、屋外・リカーブの距離無しのラウンドとする。
function buildCreatedOperation(
  preset: Preset | null,
  generateId: () => string,
  now: Date,
): CreatedOperation {
  const distances = preset
    ? toRoundDistances(preset.preset_distances, generateId)
    : [];
  return {
    type: "round.created",
    eventId: generateId(),
    roundId: generateId(),
    name: "",
    roundDate: now.toISOString().slice(0, 10),
    format: preset?.format ?? "outdoor",
    bowType: preset?.bow_type ?? "recurve",
    distances,
  };
}

// 認証を確認する。時間切れと例外は、認証を確認できない(unknown)として扱う。
async function checkSession(): Promise<SessionState | { status: "unknown" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SESSION_CHECK_TIMEOUT_MS);
    });
    const result = await Promise.race([
      createClient().auth.getSession(),
      timeout,
    ]);
    return result ? classifySession(result) : { status: "unknown" };
  } catch {
    return { status: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

// 選択中のプリセット（未選択ならnull）から、ラウンドの作成を操作の列へ積む。
// 端末への保存の完了だけを待ち、サーバーへの送信は待たない。
// 作成後の遷移と、送信中の状態の管理は呼び出し元の画面が担う。
export async function startRound({
  preset,
  isMounted,
  generateId,
  now,
}: {
  preset: Preset | null;
  isMounted: () => boolean;
  generateId: () => string;
  now: () => Date;
}): Promise<StartRoundResult> {
  const state = await checkSession();
  if (!isMounted()) return { status: "discarded" };
  // 未認証と確認できたときだけ止める。認証を確認できないときは開始する(送信は認証が回復するまで待つ)。
  if (state.status === "unauthenticated") {
    return { status: "failed", error: sessionFailureMessage(state) };
  }

  const operation = buildCreatedOperation(preset, generateId, now());
  await roundOpHub.acquire(roundStreamId(operation.roundId)).append(operation);
  return { status: "created", roundId: operation.roundId };
}

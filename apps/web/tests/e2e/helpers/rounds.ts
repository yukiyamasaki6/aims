import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInWithEmailOtp, testUserSession } from "./auth";

const DEFAULT_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001"; // 10点的（アウトドア・122cm）

// ローカル・CIのTURNSTILE_SECRET_KEYはCloudflareのテスト専用
// シークレット（常に検証を通過する）のため、captchaTokenの値自体は
// 任意の非空文字列でよい。
export async function signInAsTestUser(email: string, _password: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables in e2e helper.");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  try {
    const stored = testUserSession(email);
    const { data, error } = stored
      ? await supabase.auth.setSession(stored)
      : await signInWithEmailOtp(supabase, email);
    if (error || !data.user)
      throw new Error(
        `OTP verification failed: ${error?.code ?? "missing user"}`,
      );
    return { supabase, userId: data.user.id };
  } catch (error) {
    await supabase.auth.stopAutoRefresh();
    throw error;
  }
}

// スコア入力等のUI検証には/rounds/newのプリセット選択では用意できない任意の
// 距離構成（的、Marked/Unmarked）と記録済みの得点を自由に用意する必要があるため、本番アプリにテスト専用のAPIを持たせず、
// supabase-jsから対象ユーザーでサインインしてcreate_round RPCを直接呼ぶ。
export async function createRound(input: {
  email: string;
  password: string;
  name: string;
  roundDate: string;
  format?: string;
  bowType?: string;
  distances: {
    distance: number;
    totalEnds: number;
    arrowsPerEnd: number;
    targetFaceId?: string;
    isMarked?: boolean;
  }[];
  // 記録済みの得点を持つラウンドが必要なテスト用。distanceIndexはdistancesの添字。
  // idを省くと無作為のUUIDで新しい矢を記録する。射手と射順は、指定したときだけ送る。
  shots?: {
    id?: string;
    distanceIndex: number;
    endNumber: number;
    scoreStr: string;
    scoreInt: number;
    shooterId?: string;
    shotNumber?: number;
  }[];
}): Promise<string> {
  const { supabase } = await signInAsTestUser(input.email, input.password);
  try {
    return await createRoundWithClient(supabase, input);
  } finally {
    await supabase.auth.stopAutoRefresh();
  }
}

export async function createRoundWithClient(
  supabase: SupabaseClient,
  input: Omit<Parameters<typeof createRound>[0], "email" | "password">,
): Promise<string> {
  const roundId = randomUUID();
  const distanceIds = input.distances.map(() => randomUUID());

  const { error } = await supabase.rpc("create_round", {
    p_round_event_id: randomUUID(),
    p_id: roundId,
    p_name: input.name,
    p_round_date: input.roundDate,
    p_format: input.format ?? "outdoor",
    p_bow_type: input.bowType ?? "recurve",
    p_distances: input.distances.map((d, index) => ({
      distance_event_id: randomUUID(),
      id: distanceIds[index],
      position_key: String(index + 1).padStart(12, "0"),
      distance: d.distance,
      is_marked: d.isMarked ?? true,
      total_ends: d.totalEnds,
      arrows_per_end: d.arrowsPerEnd,
      target_face_id: d.targetFaceId ?? DEFAULT_TARGET_FACE_ID,
    })),
  });

  if (error) throw error;

  if (input.shots && input.shots.length > 0) {
    const { error: shotsError } = await supabase.rpc("record_shots", {
      p_shots: input.shots.map((s) => ({
        shot_event_id: randomUUID(),
        shot_id: s.id ?? randomUUID(),
        distance_id: distanceIds[s.distanceIndex],
        end_number: s.endNumber,
        score_str: s.scoreStr,
        score_int: s.scoreInt,
        ...(s.shooterId === undefined ? {} : { shooter_id: s.shooterId }),
        ...(s.shotNumber === undefined ? {} : { shot_number: s.shotNumber }),
      })),
    });
    if (shotsError) {
      throw shotsError;
    }
  }

  return roundId;
}

// 同期の状態(文言、アイコンを含む枠)を表示しないこと。画面の内容が表示された後に呼ぶ。
export async function expectNoSyncStatus(page: Page) {
  await expect(page.getByTestId("sync-status")).toHaveCount(0);
  await expect(page.getByText(/同期済み|同期中…|同期保留中/)).toHaveCount(0);
}

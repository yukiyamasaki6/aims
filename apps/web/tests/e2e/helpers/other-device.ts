import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signInAsTestUser } from "./rounds";

// 他端末の操作を、ページとは別のsupabase-jsクライアントからRPCを直接呼んで再現する。
// ページがオフラインの間に呼べば、他端末の操作が先に確定した状況を作れる。
export async function openOtherDevice(email: string, password: string) {
  const { supabase, userId } = await signInAsTestUser(email, password);
  return { supabase, userId };
}

export async function getDistanceIds(
  supabase: SupabaseClient,
  roundId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("distances")
    .select("id")
    .eq("round_id", roundId)
    .is("disabled_at", null)
    .order("position_key");
  if (error) throw error;
  return data.map((d) => d.id as string);
}

async function call(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

export function updateDistance(
  supabase: SupabaseClient,
  distanceId: string,
  changes: Record<string, unknown>,
) {
  return call(supabase, "update_distance", {
    p_distance_event_id: randomUUID(),
    p_distance_id: distanceId,
    p_changes: changes,
  });
}

export function updateRound(
  supabase: SupabaseClient,
  roundId: string,
  changes: Record<string, unknown>,
) {
  return call(supabase, "update_round", {
    p_round_event_id: randomUUID(),
    p_round_id: roundId,
    p_changes: changes,
  });
}

export function disableRound(supabase: SupabaseClient, roundId: string) {
  return call(supabase, "disable_round", {
    p_round_event_id: randomUUID(),
    p_round_id: roundId,
  });
}

export function disableDistance(supabase: SupabaseClient, distanceId: string) {
  return call(supabase, "disable_distance", {
    p_distance_event_id: randomUUID(),
    p_distance_id: distanceId,
  });
}

export function createDistance(
  supabase: SupabaseClient,
  roundId: string,
  input: {
    positionKey: string;
    distance: number | null;
    isMarked: boolean;
    totalEnds: number;
    arrowsPerEnd: number;
    targetFaceId: string;
  },
) {
  return call(supabase, "create_distance", {
    p_distance_event_id: randomUUID(),
    p_id: randomUUID(),
    p_round_id: roundId,
    p_position_key: input.positionKey,
    p_distance: input.distance,
    p_is_marked: input.isMarked,
    p_total_ends: input.totalEnds,
    p_arrows_per_end: input.arrowsPerEnd,
    p_target_face_id: input.targetFaceId,
  });
}

export function recordShot(
  supabase: SupabaseClient,
  shot: {
    distanceId: string;
    endNumber: number;
    arrowNumber: number;
    scoreStr: string;
    scoreInt: number;
    shooterId: string;
  },
) {
  return call(supabase, "record_shots", {
    p_shots: [
      {
        shot_event_id: randomUUID(),
        distance_id: shot.distanceId,
        end_number: shot.endNumber,
        arrow_number: shot.arrowNumber,
        shooter_id: shot.shooterId,
        score_str: shot.scoreStr,
        score_int: shot.scoreInt,
      },
    ],
  });
}

// ページの送信を、指定したユーザーとして実サーバーへ転送し、サーバーの応答をそのままページへ返す。
// 認可の拒否（PT403）や契約の不一致（PT422）の、HTTPステータスとコードを実際の応答で再現する。
export async function forwardAs(
  route: Route,
  supabase: SupabaseClient,
  mutateBody: (body: unknown) => unknown = (body) => body,
) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !anonKey) throw new Error("セッションを取得できません。");
  const request = route.request();
  const response = await fetch(request.url(), {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(mutateBody(request.postDataJSON())),
  });
  await route.fulfill({
    status: response.status,
    contentType: "application/json",
    body: await response.text(),
  });
  return response.status;
}

// 他端末の確定より後に、ページ側の送信を始める。
export async function goOnline(page: Page) {
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

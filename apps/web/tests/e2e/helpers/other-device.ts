import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { testUserSession } from "./auth";
import { signInAsTestUser } from "./rounds";

// 他端末の操作を、ページとは別のsupabase-jsクライアントからRPCを直接呼んで再現する。
// ページがオフラインの間に呼べば、他端末の操作が先に確定した状況を作れる。
// ページが同じ宛先へ送ったコードの送信間隔を待たないよう、メールを送らず、
// そのテストの記憶済みのセッションのアクセストークンだけを使う。
// 更新しないクライアントにし、ブラウザと同じリフレッシュトークンを回さない。
export async function openOtherDevice(email: string, password: string) {
  const stored = testUserSession(email);
  if (!stored) return signInAsTestUser(email, password);
  const supabase = createClient(url(), anonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.setSession(stored);
  if (error || !data.user)
    throw new Error(`Other device session failed: ${error?.code}`);
  return { supabase, userId: data.user.id };
}

function url() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value)
    throw new Error("Missing Supabase environment variables in e2e helper.");
  return value;
}
function anonKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value)
    throw new Error("Missing Supabase environment variables in e2e helper.");
  return value;
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

// ラウンドの行の、同期で変わる項目。
export async function getRoundRow(supabase: SupabaseClient, roundId: string) {
  const { data, error } = await supabase
    .from("rounds")
    .select("name, status, format, bow_type, round_date")
    .eq("id", roundId)
    .single();
  if (error) throw error;
  return data;
}

// 保存された(削除されていない)ラウンドの件数。
export async function savedRoundCount(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("rounds")
    .select("id")
    .eq("id", id)
    .is("disabled_at", null);
  if (error) throw error;
  return data.length;
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

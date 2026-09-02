import { createClient } from "@supabase/supabase-js";

const DEFAULT_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000001"; // 10点的（アウトドア・122cm）
export const SIX_RING_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000003"; // 6点的（アウトドア・80cm）: X,10,9,8,7,6,5のみ
export const TRIPLE_SPOT_TARGET_FACE_ID =
  "a1000000-0000-0000-0000-000000000008"; // 6点的（インドア・40cm・3つ目トライアングル）: 3スポット、各スポット同一の10,9,8,7,6（Xリングを持たない）
// フィールド的（80cm）: 6,5が黄・4,3,2,1が黒。WA標準的の得点しきい値（9以上=黄,
// 7-8=赤,5-6=青,3-4=黒,1-2=白）とは対応しない配色のため、色が的の実際の
// リング色に追従しているかの検証に使う。
export const FIELD_TARGET_FACE_ID = "a1000000-0000-0000-0000-000000000010";

// スコア入力等のUI検証には/rounds/newのプリセット選択では用意できない任意の
// 距離構成（少エンド・少射数）が必要なため、本番アプリにテスト専用のAPIを持たせず、
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
  }[];
}): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables in e2e helper.");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // ローカル・CIのTURNSTILE_SECRET_KEYはCloudflareのテスト専用
  // シークレット（常に検証を通過する）のため、captchaTokenの値自体は
  // 任意の非空文字列でよい。
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
    options: { captchaToken: "test-captcha-token" },
  });
  if (signInError) {
    throw signInError;
  }

  const { data: roundId, error } = await supabase.rpc("create_round", {
    p_name: input.name,
    p_round_date: input.roundDate,
    p_format: input.format ?? "outdoor",
    p_bow_type: input.bowType ?? "recurve",
    p_distances: input.distances.map((d) => ({
      distance: d.distance,
      total_ends: d.totalEnds,
      arrows_per_end: d.arrowsPerEnd,
      target_face_id: d.targetFaceId ?? DEFAULT_TARGET_FACE_ID,
    })),
  });

  if (error || !roundId) {
    throw error ?? new Error("ラウンドの作成に失敗しました。");
  }

  return roundId;
}

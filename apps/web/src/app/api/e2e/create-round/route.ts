import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// e2eテストのフィクスチャ作成専用。/rounds/new のUI（プリセット選択）を経由せず、
// スコア入力等のUI検証に必要な任意の距離構成でラウンドを直接作成する。
// create_round RPC自体はUIからも同様に呼べる公開APIのため、この経路が
// 追加の権限を開放するものではない。
export async function POST(request: Request) {
  const body = await request.json();
  const supabase = await createClient();

  const { data: roundId, error } = await supabase.rpc("create_round", {
    p_name: body.name,
    p_round_date: body.roundDate,
    p_format: body.format,
    p_bow_type: body.bowType,
    p_distances: body.distances,
  });

  if (error || !roundId) {
    return NextResponse.json(
      { error: error?.message ?? "ラウンドの作成に失敗しました。" },
      { status: 400 },
    );
  }

  return NextResponse.json({ roundId });
}

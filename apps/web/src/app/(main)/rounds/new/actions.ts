"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createRoundFromPreset(
  presetId: string,
): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const { data: preset, error: presetError } = await supabase
    .from("round_presets")
    .select(
      "format, bow_type, round_preset_distances(distance_number, distance, total_ends, arrows_per_end, target_face_id)",
    )
    .eq("id", presetId)
    .maybeSingle();

  if (presetError || !preset) {
    return { error: "プリセットの取得に失敗しました。" };
  }

  const distances = [...preset.round_preset_distances]
    .sort((a, b) => a.distance_number - b.distance_number)
    .map((d) => ({
      distance: d.distance,
      total_ends: d.total_ends,
      arrows_per_end: d.arrows_per_end,
      target_face_id: d.target_face_id,
    }));

  const { data: roundId, error } = await supabase.rpc("create_round", {
    p_name: "",
    p_round_date: new Date().toISOString().slice(0, 10),
    p_format: preset.format,
    p_bow_type: preset.bow_type,
    p_distances: distances,
  });

  if (error || !roundId) {
    return { error: error?.message ?? "ラウンドの作成に失敗しました。" };
  }

  redirect(`/rounds/${roundId}`);
}

export async function createCustomRound(): Promise<
  { error: string } | undefined
> {
  const supabase = await createClient();

  const { data: roundId, error } = await supabase.rpc("create_round", {
    p_name: "",
    p_round_date: new Date().toISOString().slice(0, 10),
    p_format: "outdoor",
    p_bow_type: "recurve",
    p_distances: [],
  });

  if (error || !roundId) {
    return { error: error?.message ?? "ラウンドの作成に失敗しました。" };
  }

  redirect(`/rounds/${roundId}`);
}

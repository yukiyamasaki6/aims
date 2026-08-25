"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type DistanceInput = {
  distance: number;
  totalEnds: number;
  arrowsPerEnd: number;
};

export async function createRound(input: {
  name: string;
  roundDate: string;
  distances: DistanceInput[];
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const { data: roundId, error } = await supabase.rpc("create_round", {
    p_name: input.name,
    p_round_date: input.roundDate,
    p_distances: input.distances.map((d) => ({
      distance: d.distance,
      total_ends: d.totalEnds,
      arrows_per_end: d.arrowsPerEnd,
    })),
  });

  if (error || !roundId) {
    return { error: error?.message ?? "ラウンドの作成に失敗しました。" };
  }

  redirect(`/rounds/${roundId}`);
}

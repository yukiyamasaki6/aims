"use server";

import { createClient } from "@/lib/supabase/server";

export async function recordShot(input: {
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
  scoreStr: string;
  scoreInt: number;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  const { error } = await supabase.from("shots").upsert(
    {
      distance_id: input.distanceId,
      end_number: input.endNumber,
      arrow_number: input.arrowNumber,
      user_id: user.id,
      score_str: input.scoreStr,
      score_int: input.scoreInt,
    },
    { onConflict: "distance_id,user_id,end_number,arrow_number" },
  );

  if (error) {
    return { error: error.message };
  }
}

export async function clearShot(input: {
  distanceId: string;
  endNumber: number;
  arrowNumber: number;
}): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  const { error } = await supabase.from("shots").delete().match({
    distance_id: input.distanceId,
    end_number: input.endNumber,
    arrow_number: input.arrowNumber,
    user_id: user.id,
  });

  if (error) {
    return { error: error.message };
  }
}

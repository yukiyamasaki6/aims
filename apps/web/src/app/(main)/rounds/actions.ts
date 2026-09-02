"use server";

import { createClient } from "@/lib/supabase/server";

export async function deleteRound(
  roundId: string,
): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const { error } = await supabase.from("rounds").delete().eq("id", roundId);

  if (error) {
    return { error: error.message };
  }
}

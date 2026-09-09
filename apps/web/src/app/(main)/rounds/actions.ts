"use server";

import { createClient } from "@/lib/supabase/server";

export async function deleteRound(
  roundId: string,
): Promise<{ error: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "サインインが必要です。" };
  }

  const { error } = await supabase.from("rounds").delete().eq("id", roundId);

  if (error) {
    return { error: error.message };
  }
}

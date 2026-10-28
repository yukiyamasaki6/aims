"use server";

import { createSupabaseRegistrationCheck } from "@/features/auth/infrastructure/supabase-registration-check";
import { createAdminClient } from "@/lib/supabase/server";

export async function isEmailRegistered(email: string): Promise<boolean> {
  return createSupabaseRegistrationCheck(createAdminClient)(email);
}

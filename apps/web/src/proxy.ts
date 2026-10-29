import type { NextRequest } from "next/server";
import { redirectFor } from "@/features/auth/domain/routes";
import { updateSession } from "@/lib/supabase/infrastructure/session";

export async function proxy(request: NextRequest) {
  return await updateSession(request, redirectFor);
}

export const config = {
  matcher: ["/signin", "/signup", "/reset-password", "/rounds/:path*"],
};

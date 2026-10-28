import type { NextRequest } from "next/server";
import { redirectFor } from "@/features/auth";
import { updateSession } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  return await updateSession(request, redirectFor);
}

export const config = {
  matcher: ["/signin", "/signup", "/reset-password", "/rounds/:path*"],
};

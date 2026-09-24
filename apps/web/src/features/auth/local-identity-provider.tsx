"use client";

import { useEffect } from "react";
import { initLocalIdentity } from "@/features/auth/local-identity";
import { createClient } from "@/lib/supabase/client";

// signin/signupを含む全ページで有効にする必要があるため、ルートレイアウトに
// マウントする。表示は何も行わない。
export function LocalIdentityProvider() {
  useEffect(() => {
    const supabase = createClient();
    return initLocalIdentity(supabase);
  }, []);

  return null;
}

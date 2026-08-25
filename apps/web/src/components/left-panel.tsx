import { createClient } from "@/lib/supabase/server";
import { LeftPanelClient } from "./left-panel-client";

export async function LeftPanel() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <LeftPanelClient isSignedIn={!!user} />;
}

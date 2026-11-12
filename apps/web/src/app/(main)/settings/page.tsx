"use client";

import { useSession } from "@/features/auth/ui/session-context";
import { SignOutButton } from "@/features/auth/ui/sign-out-button";
import { SettingsScreen } from "@/features/settings/ui/settings-screen";

export default function SettingsPage() {
  const session = useSession();
  return (
    <SettingsScreen account={<SignOutButton signOut={session.signOut} />} />
  );
}

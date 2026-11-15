"use client";

import { useDeleteAccount } from "@/features/auth/ui/delete-account-context";
import { DeleteAccountForm } from "@/features/auth/ui/delete-account-form";

export default function DeleteAccountPage() {
  return (
    <DeleteAccountForm
      deleteAccount={useDeleteAccount()}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}

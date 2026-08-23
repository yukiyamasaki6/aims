import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";

export async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <Link href="/" className="font-bold">
        AIMS
      </Link>
      {user ? (
        <form action={signOut} className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{user.email}</span>
          <button type="submit" className="underline">
            サインアウト
          </button>
        </form>
      ) : (
        <Link href="/signin" className="text-sm underline">
          サインイン
        </Link>
      )}
    </header>
  );
}

import { createClient } from "@/lib/supabase/server";

export default async function RoundsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-bold">ラウンド一覧</h1>
      <p className="text-muted-foreground text-sm">
        {user?.email} でサインイン中です。
      </p>
    </main>
  );
}

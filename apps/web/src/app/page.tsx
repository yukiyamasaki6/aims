import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/rounds");
  }

  return (
    <AuthCard
      title="AIMS"
      description="アーチェリーのスコア記録・分析・共有アプリ"
    >
      <Link href="/signup" className={buttonVariants({ variant: "default" })}>
        開始
      </Link>
    </AuthCard>
  );
}

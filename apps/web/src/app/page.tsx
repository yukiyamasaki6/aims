import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
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

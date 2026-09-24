import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-sm flex-col items-center justify-center gap-4 overflow-y-auto p-8">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="font-heading text-2xl leading-snug font-medium">AIMS</h1>
        <p className="text-sm text-muted-foreground">
          アーチェリーのスコア記録・分析・共有アプリ
        </p>
      </div>
      <Link href="/signup" className={buttonVariants({ variant: "default" })}>
        開始
      </Link>
    </main>
  );
}

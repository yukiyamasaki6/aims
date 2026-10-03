import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export function BackToListLink() {
  return (
    <Link
      href="/rounds"
      className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      一覧へ戻る
    </Link>
  );
}

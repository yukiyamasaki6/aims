import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { ROUNDS_PATH } from "../domain/round-routes";

export function BackToListLink() {
  return (
    <Link
      href={ROUNDS_PATH}
      className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      一覧へ戻る
    </Link>
  );
}

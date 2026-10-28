import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 処理中の表示を持つボタン。処理中は無効の見た目(aria-disabledと押せない表示)にし、spinnerが真のときはスピナーを出す。
// 処理中の判定は呼び出し側が持ち、この部品は表現だけを担う。
export function BusyButton({
  busy,
  spinner = busy,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & { busy: boolean; spinner?: boolean }) {
  return (
    <Button
      aria-disabled={busy}
      className={cn(className, busy && "pointer-events-none opacity-50")}
      {...props}
    >
      {spinner && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </Button>
  );
}

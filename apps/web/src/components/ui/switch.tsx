"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { useId } from "react";

import { cn } from "@/lib/utils";

// 見出しを左、つまみが左右に動くスイッチを右に置いた1行。見出しはスイッチの名前になる。
function Switch({
  label,
  checked,
  onChange,
  testId,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
  className?: string;
}) {
  const labelId = useId();
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span id={labelId} className="font-medium text-sm">
        {label}
      </span>
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onChange}
        aria-labelledby={labelId}
        data-testid={testId}
        className="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-input outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-primary"
      >
        <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-background shadow transition-transform data-checked:translate-x-[1.125rem]" />
      </SwitchPrimitive.Root>
    </div>
  );
}

export { Switch };

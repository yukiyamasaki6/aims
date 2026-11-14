"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";

import { cn } from "@/lib/utils";

type SelectOption = { value: string; label: string };

// base-uiのSelectを包んだ選択欄。項目名は見えるラベルで、トリガーへ関連付ける。
// 値の状態は使う側が持つ。未選択の表示も、選択肢の1つとして使う側が渡す。
function Select({
  label,
  options,
  value,
  onChange,
  testId,
  className,
}: {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root
      items={options}
      value={value}
      // 型はnullを含むが、値は選択肢(文字列)からしか届かない(base-uiは項目の値と自動入力の一致でだけ変更を通知し、nullでは呼ばない)。
      onValueChange={(next) => onChange(next as string)}
    >
      <div className={cn("flex min-w-0 flex-col gap-1", className)}>
        <SelectPrimitive.Label className="text-muted-foreground text-xs">
          {label}
        </SelectPrimitive.Label>
        <SelectPrimitive.Trigger
          data-testid={testId}
          className="flex h-8 w-full min-w-0 items-center justify-between gap-1 rounded-lg border border-input bg-transparent px-2 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        >
          <SelectPrimitive.Value />
          <SelectPrimitive.Icon className="text-muted-foreground">
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" />
            </svg>
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
      </div>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          alignItemWithTrigger={false}
          sideOffset={4}
          className="z-[60]"
        >
          <SelectPrimitive.Popup className="max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto rounded-lg border bg-card p-1 text-card-foreground shadow-md outline-none">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="cursor-default rounded-md px-2 py-1.5 text-base outline-none data-highlighted:bg-muted data-selected:font-semibold md:text-sm"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { Select };

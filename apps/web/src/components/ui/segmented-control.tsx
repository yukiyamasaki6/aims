"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { CSSProperties } from "react";

type SegmentedOption = { value: string; label: string };

// 選択肢を並べて常に見せる単一選択。両端が半円の容器の中に、選択肢が等幅で並び、選択中は一回り小さい丸めた背景(指標)で浮かぶ(選択していないものは背景なしの文字)。指標は選択肢とは別の1つで、選択を切り替えると、動きを減らす設定でなければ、前の選択肢から移動する。名前は読み上げ用で画面に出さない。値の状態は使う側が持つ。
function SegmentedControl({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: readonly SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  const selected = options.findIndex((option) => option.value === value);
  const indicatorStyle = {
    "--segment-count": options.length,
    "--segment-index": selected,
  } as CSSProperties;
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(next as string)}
      data-testid={testId}
      className="inline-grid auto-cols-fr grid-flow-col relative rounded-full bg-muted p-0.5"
    >
      {selected >= 0 && (
        <span
          aria-hidden="true"
          data-testid={testId ? `${testId}-indicator` : undefined}
          style={indicatorStyle}
          className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc((100%-0.25rem)/var(--segment-count))] translate-x-[calc(var(--segment-index)*100%)] rounded-full bg-background shadow-sm transition-transform duration-200 motion-reduce:transition-none"
        />
      )}
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          data-testid={testId ? `${testId}-${option.value}` : undefined}
          className="relative z-10 inline-flex h-7 cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-2.5 text-muted-foreground text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:text-foreground"
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export { SegmentedControl };

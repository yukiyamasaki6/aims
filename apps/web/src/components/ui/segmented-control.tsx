"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

type SegmentedOption = { value: string; label: string };

// 選択肢を並べて常に見せる単一選択。両端が半円の容器の中に、選択肢が等幅で並び、選択中の選択肢は一回り小さい丸めた背景で浮かぶ(選択していないものは背景なしの文字)。名前は読み上げ用で画面に出さない。値の状態は使う側が持つ。
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
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(next as string)}
      data-testid={testId}
      className="inline-grid auto-cols-fr grid-flow-col rounded-full bg-muted p-0.5"
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          data-testid={testId ? `${testId}-${option.value}` : undefined}
          className="inline-flex h-7 cursor-pointer items-center justify-center rounded-full px-4 text-muted-foreground text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-background data-checked:text-foreground data-checked:shadow-sm"
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export { SegmentedControl };

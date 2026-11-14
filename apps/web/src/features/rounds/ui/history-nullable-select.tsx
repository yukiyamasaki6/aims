import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";

export type SelectOption<T extends string> = { value: T; label: string };

// Selectの値は文字列のため、指定なし(null)を表す値。選択肢には渡すが、条件の値には現れない。
const NONE = "none";

// 先頭に「指定なし」を持つ単一選択。値と指定なし(null)の写しは、ここだけが持つ。
export function NullableSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  testId,
  className,
}: {
  label: string;
  options: readonly SelectOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  testId?: string;
  className?: string;
}) {
  const t = useTranslations("rounds");
  return (
    <Select
      label={label}
      options={[{ value: NONE, label: t("historyFilterNone") }, ...options]}
      value={value ?? NONE}
      onChange={(next) =>
        onChange(options.find((option) => option.value === next)?.value ?? null)
      }
      testId={testId}
      className={className}
    />
  );
}

import { useTranslations } from "next-intl";
import {
  BOW_TYPE_OPTIONS,
  type BowTypeOption,
  FORMAT_OPTIONS,
  type FormatOption,
} from "../domain/round-constants";

function isFormat(value: string): value is FormatOption {
  return (FORMAT_OPTIONS as readonly string[]).includes(value);
}

function isBowType(value: string): value is BowTypeOption {
  return (BOW_TYPE_OPTIONS as readonly string[]).includes(value);
}

// 種別と弓種の表示名。選択肢に無い値は、値のまま返す。
export function useOptionLabels() {
  const t = useTranslations("rounds");
  const formatLabel = (value: string) =>
    isFormat(value) ? t(`formatOption.${value}`) : value;
  const bowTypeLabel = (value: string) =>
    isBowType(value) ? t(`bowTypeOption.${value}`) : value;
  return {
    formatLabel,
    bowTypeLabel,
    formatOptions: FORMAT_OPTIONS.map((value) => ({
      value,
      label: formatLabel(value),
    })),
    bowTypeOptions: BOW_TYPE_OPTIONS.map((value) => ({
      value,
      label: bowTypeLabel(value),
    })),
  };
}

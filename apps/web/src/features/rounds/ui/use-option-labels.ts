import { useTranslations } from "next-intl";
import {
  BOW_TYPE_OPTIONS,
  type BowTypeOption,
  FORMAT_OPTIONS,
  type FormatOption,
} from "../domain/round-constants";

// 種別と弓種の表示名。値はDBのCHECKで選択肢のどれかに限られる。
// 値の型が文字列の使い手が多く、取得の境界から型を絞ると広がるため、引数は文字列のまま受けて文言の引き方で選択肢の型にする。
export function useOptionLabels() {
  const t = useTranslations("rounds");
  const formatLabel = (value: string) =>
    t(`formatOption.${value as FormatOption}`);
  const bowTypeLabel = (value: string) =>
    t(`bowTypeOption.${value as BowTypeOption}`);
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

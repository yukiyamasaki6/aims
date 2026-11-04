import {
  createTranslator,
  type NamespaceKeys,
  type NestedKeyOf,
} from "use-intl/core";
import { intlConfig } from "./messages";

type Namespace = NamespaceKeys<
  typeof intlConfig.messages,
  NestedKeyOf<typeof intlConfig.messages>
>;

// テストでは、見つからないキーと書式の誤りを、onErrorで例外にする(見つからない文言の代わりは使われない)。
export const strictIntlConfig = {
  ...intlConfig,
  onError: (error: Error): void => {
    throw error;
  },
};

// 単体テストとE2Eが、期待値や要素を探す手がかりの文言を得る。名前空間ごとに作る。
export function translatorFor<const N extends Namespace>(namespace: N) {
  return createTranslator({ ...strictIntlConfig, namespace });
}

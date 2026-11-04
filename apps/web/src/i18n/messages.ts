import type { IntlConfig, IntlError } from "next-intl";

const locale = "ja";

// 名前空間ごとに、各機能の文言の一覧(ja)を集める。新しい一覧は、ここへ名前空間として足す。
const messages = {
  auth: {},
  rounds: {},
  navigation: {},
  offlinePwa: {},
  shared: {},
} as const;

declare module "next-intl" {
  interface AppConfig {
    // biome-ignore lint/style/useNamingConvention: next-intlが定める型の登録の名前
    Locale: typeof locale;
    // biome-ignore lint/style/useNamingConvention: next-intlが定める型の登録の名前
    Messages: typeof messages;
  }
}

// 見つからないとき、書式に失敗したときは、キーを利用者に出さず、空の文字列にする。
// 開発時だけ、console.errorで知らせる。
export const intlConfig = {
  locale,
  messages,
  getMessageFallback: () => "",
  onError: (error: IntlError) => {
    if (process.env.NODE_ENV !== "production") console.error(error);
  },
} as const satisfies IntlConfig;

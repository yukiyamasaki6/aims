import { useTranslations } from "next-intl";
import type { AuthFailureKind } from "../domain/auth-failure";
import type { FieldErrorKinds } from "../domain/flow";

// 失敗の種類と、欄ごとの入力の誤りの種類を、文言にする。種類が無ければ、文言も無い。
// 欄の名前と誤りの種類は型で組になっていて、文言の一覧が全ての組に本文を持つことは、一覧の`satisfies`が確かめる。
export function useAuthTexts() {
  const t = useTranslations("auth");
  const lookup = t as unknown as (key: string) => string;
  return {
    failure: (kind: AuthFailureKind | null) =>
      kind === null ? null : t(`failure.${kind}`),
    // 画面の全体のエラーの文言。失敗と、チェックの失敗(`fieldErrors.captcha`)を、同じ段落に続けて並べる(同時には起きない)。
    screenError: (
      kind: AuthFailureKind | null,
      captcha: FieldErrorKinds["captcha"] | undefined,
    ) => {
      const text = [
        kind === null ? "" : t(`failure.${kind}`),
        captcha === undefined ? "" : lookup(`fieldError.captcha.${captcha}`),
      ].join("");
      return text === "" ? null : text;
    },
    fieldError: <Field extends keyof FieldErrorKinds>(
      field: Field,
      kind: FieldErrorKinds[Field] | undefined,
    ) =>
      kind === undefined ? undefined : lookup(`fieldError.${field}.${kind}`),
  };
}

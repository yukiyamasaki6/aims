# auth/password-reset 廃止設計

## 概要

パスワード再設定の画面・機能・ルートを削除する。
`/reset-password`の互換ページ、遷移専用入口、特別なリダイレクトは残さない。
存在しない他のURLと同じ、アプリ共通の未定義ルートの扱いとする。

## 構成とデータの流れ

`apps/web/src/app/(auth)/reset-password/page.tsx`と機能固有のdomain/application/ui・パスワードIO・不要な規則・入力部品・文言を削除する。
`apps/web/src/routes.ts`のRESET_PASSWORD_PATH、auth-routes.tsの経路判定、proxy.tsのmatcherから再設定経路を削除する。
Next.js・Service Worker・認証ガード・E2E補助に、このURL専用の転送や互換分岐を追加しない。
再設定機能のテストと、画面が残ることを前提にしたテストデータ・CAPTCHA経路判定を削除またはOTP用へ置換する。
ログイン画面やメールからの再設定導線を削除し、認証用メールのconfirmation・magic_link・recoveryは同じ`supabase/templates/email-otp.html`を使う。
従来の再設定用テンプレートは廃止し、直接Auth APIで回復要求が来た場合も共通のコードだけのメールとする。

## 制約と未対応

この文書は廃止方針の記録であり、再設定機能や互換ルートを提供するものではない。
Auth標準の回復・パスワード更新API自体を削除する構成ではなく、直接のパスワード更新後も発行Hookでパスワード新規認証を拒否する。
直接の回復要求のコード確認は実Authが方式otpとして渡すため、通常のメールOTPと同等に扱う。この確認でパスワード認証は復活しない。

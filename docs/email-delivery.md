# メール配信基盤

認証（サインアップ・パスワードリセット）のOTPメール送信について、選定内容と設定を記録する。

## プロバイダ

**Resend**を採用。無料枠が実用的、ドメイン検証の手順がシンプルという理由で選定した。

## 送信ドメイン

Resendには**ルートドメイン`aims-archery.com`**をそのまま登録し、送信元アドレスは`noreply@aims-archery.com`を使う（`send.`等のサブドメインは使わない）。

理由: サブドメイン分離は「トランザクションメールとマーケティングメールを両方送る」場合に評判の混在を避けるための対策だが、このアプリは現状OTPメール（トランザクションのみ）しか送っていないため、分離の恩恵がない。将来マーケティングメールを送る場合は、そちら側を`info.aims-archery.com`等の別サブドメインとして新規登録し、OTPメールの評判に影響しないようにする。

## DNS（Cloudflare管理）

Resend登録時に自動生成される送信用サブドメイン`send.aims-archery.com`に、以下を設定済み（プロキシは全てDNS onlyにすること）。

| Type | Name | 内容 |
| :--- | :--- | :--- |
| MX | `send` | Resend指定の値（優先度10） |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | Resend指定のDKIM公開鍵 |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<受信用アドレス>;` |

DMARCは`p=none`（監視のみ）から開始し、正常配信を確認できたら`quarantine`→`reject`へ強化する。

## Supabase側の設定

本番・プレビュー両方のSupabaseプロジェクトのダッシュボード（Authentication → SMTP Settings）に、Resendの接続情報を直接入力済み（host: `smtp.resend.com`、user: `resend`、pass: Resend APIキー）。**SMTP認証情報はリポジトリには含めない。**

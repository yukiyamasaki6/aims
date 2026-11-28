-- 人間が手動で動作確認する際に使うアカウント（ローカルとCIの db reset で適用し、本番には絶対に適用しない）。
-- E2Eテストでは使わない。
-- サインアップ済み（メール確認済み）の状態で用意し、パスワードは持たない。
-- /signin でメールアドレスに user@aims.test を入力して「メールで続ける」を押し、ローカルのメール画面（http://127.0.0.1:54324）に届く認証コードでサインインする。
-- 既に存在する場合は何もしない（何度実行しても安全）。
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-00000000000a',
  'authenticated',
  'authenticated',
  'user@aims.test',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into auth.identities (
  user_id,
  provider_id,
  identity_data,
  provider,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-00000000000a',
  '00000000-0000-0000-0000-00000000000a',
  jsonb_build_object('sub', '00000000-0000-0000-0000-00000000000a', 'email', 'user@aims.test'),
  'email',
  now(),
  now()
)
on conflict (provider_id, provider) do nothing;

-- アカウント削除の記録(docs/backup.md)を、ローカルとCIでは送らない。
-- 記録先の設定が無いと削除は拒否されるため、'disabled'を置く。
-- プレビューはseedを適用しないため、supabase/config.tomlの[remotes.preview.db.vault]で置く。
-- 本番のVaultには記録先(Workerの宛先と鍵)を置く。
select vault.create_secret('disabled', 'account_deletion_log_endpoint')
where not exists (select 1 from vault.secrets where name = 'account_deletion_log_endpoint');

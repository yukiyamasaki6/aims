-- 人間が手動で動作確認する際に使うアカウント（ローカルとCIの db reset で適用する。
-- 本番には絶対に適用しない）。E2Eテストでは使わない（テストは全て
-- <テスト名>-${Date.now()}@aims.test という使い捨てアカウントを都度作成する）。
-- サインアップ済み（メール確認済み・パスワード設定済み）の状態で用意し、
-- 一度 /signin でサインインすれば以後の手間を省ける。
-- 既に存在する場合は何もしない（何度実行しても安全）。
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
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
  extensions.crypt('password1', extensions.gen_salt('bf')),
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

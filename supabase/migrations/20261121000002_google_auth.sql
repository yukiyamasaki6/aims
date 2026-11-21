-- Googleでの登録・サインイン、Googleアカウントの追加・削除(auth/signin、auth/link-google)のDB側。
--   - email_otp_access_token_hook: 許可する発行方式にoauth(Googleでのサインインと、手動の結合の戻りの交換)を足す。名前は変えない(migrationの適用から設定の反映までの間、発行を止めないため)
--   - ensure_email_identity(): 呼び出した利用者のメールの手段(auth.identitiesのprovider = 'email')が無ければ、認証サービスがメールアドレスの変更の完了時に作る形と同じ手段を作る。Googleの削除の直前に画面が呼ぶ
--   - keep_email_identity: 確認済みの利用者が残ったまま、メールの手段だけを削除することを拒否する。Googleの削除、アカウント削除の連鎖、メールアドレス変更による更新は通す
--   - 戻すときは、トリガーと関数の削除と、旧hookの再定義を行う追加のmigrationで行う

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

CREATE OR REPLACE FUNCTION public.email_otp_access_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
begin
  if event ->> 'authentication_method' in ('otp', 'token_refresh', 'email_change', 'oauth') then
    return jsonb_build_object('claims', event -> 'claims');
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'authentication_method_not_allowed'));
end;
$$;

CREATE FUNCTION public.ensure_email_identity() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
declare
  v_uid uuid := auth.uid();
  v_deleted_user constant uuid := '00000000-0000-4000-8000-000000000001';
  v_email text;
begin
  if v_uid is null or v_uid = v_deleted_user then
    raise exception 'email_identity_forbidden' using errcode = 'PT403';
  end if;

  -- 同じ利用者の同時の呼び出しで2行作らないよう、利用者の行をロックする。確認済みのアドレスを持つ利用者だけが対象。
  select u.email into v_email
  from auth.users u
  where u.id = v_uid
    and u.email_confirmed_at is not null
    and coalesce(u.email, '') <> ''
    and not u.is_sso_user
    and u.deleted_at is null
  for update;
  if not found then
    raise exception 'email_identity_forbidden' using errcode = 'PT403';
  end if;

  if exists (
    select 1 from auth.identities i where i.user_id = v_uid and i.provider = 'email'
  ) then
    return;
  end if;

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    v_uid::text,
    v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(),
    now(),
    now()
  );
end;
$$;

ALTER FUNCTION public.ensure_email_identity() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.ensure_email_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_email_identity() TO authenticated;

CREATE FUNCTION public.keep_email_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
begin
  -- 利用者の削除の連鎖では、利用者の行が先に消えているため通る。確認していない利用者は、認証サービスが未確認のメールの手段を消すため通す。
  if exists (
    select 1 from auth.users u where u.id = old.user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'email_identity_required';
  end if;
  return old;
end;
$$;

ALTER FUNCTION public.keep_email_identity() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.keep_email_identity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER keep_email_identity
    BEFORE DELETE ON auth.identities
    FOR EACH ROW
    WHEN (old.provider = 'email')
    EXECUTE FUNCTION public.keep_email_identity();

commit;

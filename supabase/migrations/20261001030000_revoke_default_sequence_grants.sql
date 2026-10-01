begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- issue631: postgresロールが今後publicに作るシーケンス（serial・identity）に、anon・authenticatedへの権限が自動で付かないようにする。
-- 主キーはUUIDでアプリはシーケンスを使わないため、必要になった時点で必要な権限だけを明示的にGRANTする。
-- service_roleの既定権限は信頼するロールとして変更しない。
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated";

-- 既存のシーケンスに付いている権限も同じ状態にそろえる（現在は0個だが、環境差があっても移行後の状態を同じにする）。
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "anon", "authenticated";

commit;

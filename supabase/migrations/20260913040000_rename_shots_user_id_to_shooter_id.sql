begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- ============================================================
-- shots.user_id を shots.shooter_id にリネームする。
-- このアプリのユーザーは全員アーチャーであり「archer」は「user」と
-- 同義で区別に使えない。将来、記録を送信した人（author）と実際に矢を
-- 射った人が異なりうる（例：代理入力）ことを踏まえ、行為に基づく名前
-- （誰が「射った」か）に変更する。
-- ============================================================

-- 利用開始前の改名として承認済み。アプリ側の参照も同時に変更する。
-- 保存方式の変更完了後、初期スキーマへの整理・DB再構築時にこの例外も除去する。
-- 旧クライアントとの互換性を保つ必要がない今回の1文だけを対象とする。
-- squawk-ignore renaming-column
alter table shots rename column user_id to shooter_id;
alter table shots rename constraint shots_user_id_fkey to shots_shooter_id_fkey;

commit;

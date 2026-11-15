-- 的(target_faces)から所有ユーザー(owner_id)を廃止する。個人の的の登録は提供せず、的は全て公式の定義である。
--   - owner_id列と、users(id)への外部キーtarget_faces_owner_id_fkeyを除く
--   - ポリシー・関数・トリガー・インデックスはowner_idに依存しない。権限は変えない
--   - 前提: 本番でowner_idがnullでない行が0件であること(適用前にselect count(*) from target_faces where owner_id is not nullで確認する)
--   - 戻すときは、owner_id列と外部キーを足す逆のmigrationを追加する
--   - preset_rounds.owner_id(個人プリセット)は変えない

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

ALTER TABLE "public"."target_faces" DROP CONSTRAINT "target_faces_owner_id_fkey";

-- squawk-ignore ban-drop-column
ALTER TABLE "public"."target_faces" DROP COLUMN "owner_id";

commit;

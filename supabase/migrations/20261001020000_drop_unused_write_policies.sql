begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- issue622: アプリから使われない書き込みポリシーとGRANTを削除し、検証すべき認可の面を最小にする。
-- アプリが直接書くのはpreset_roundsのDELETEとINSERT（save_round_as_presetはSECURITY INVOKERのため
-- preset_rounds・preset_distancesのINSERTポリシーも必要）だけで、他の書き込みはSECURITY DEFINERのRPCかトリガー経由のため、
-- RLSもGRANTも要らない。
-- rounds・distances・shotsの書き込みポリシーは20260915040000で削除済み、GRANTは20261001000000で剥奪済み。
-- service_roleとSECURITY DEFINER関数・トリガー（所有者postgres）の権限には影響しない。

-- round_users: 書き込み経路がない（メンバー管理はチーム機能で必要になった時点で設計する）。SELECTだけ残す。
DROP POLICY "insert_if_editor" ON "public"."round_users";
DROP POLICY "update_if_editor" ON "public"."round_users";
DROP POLICY "delete_if_editor" ON "public"."round_users";
REVOKE INSERT, UPDATE, DELETE ON TABLE "public"."round_users" FROM "authenticated";

-- target_faces系: 的はシードのみでアプリからの書き込みがない。SELECTだけ残す。
DROP POLICY "insert_own" ON "public"."target_faces";
DROP POLICY "update_own" ON "public"."target_faces";
DROP POLICY "delete_own" ON "public"."target_faces";
DROP POLICY "insert_if_owner" ON "public"."target_face_spots";
DROP POLICY "update_if_owner" ON "public"."target_face_spots";
DROP POLICY "delete_if_owner" ON "public"."target_face_spots";
DROP POLICY "insert_if_owner" ON "public"."target_face_rings";
DROP POLICY "update_if_owner" ON "public"."target_face_rings";
DROP POLICY "delete_if_owner" ON "public"."target_face_rings";
REVOKE INSERT, UPDATE, DELETE ON TABLE
  "public"."target_faces",
  "public"."target_face_spots",
  "public"."target_face_rings"
FROM "authenticated";

-- preset_rounds: UPDATEは使われない。INSERT（save_round_as_preset）とDELETE（プリセットの削除）は残す。
DROP POLICY "update_own" ON "public"."preset_rounds";
REVOKE UPDATE ON TABLE "public"."preset_rounds" FROM "authenticated";

-- preset_distances: UPDATE・DELETEは使われない。INSERT（save_round_as_preset）は残す。
-- 親のpreset_roundsを削除したときの行の削除は、外部キーのCASCADEがRLS・GRANTによらず行う。
DROP POLICY "update_if_owner" ON "public"."preset_distances";
DROP POLICY "delete_if_owner" ON "public"."preset_distances";
REVOKE UPDATE, DELETE ON TABLE "public"."preset_distances" FROM "authenticated";

-- users: 他人の行は読めなくし、本人の行だけ読めるようにする。UPDATE（本人のプロフィール更新）は残す。
-- 行の作成はhandle_new_userトリガー、削除はauth.usersからのCASCADEが行うため、直接のDELETEは不要。
DROP POLICY "select_all_authenticated" ON "public"."users";
CREATE POLICY "select_own" ON "public"."users" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));
DROP POLICY "delete_own" ON "public"."users";
REVOKE DELETE ON TABLE "public"."users" FROM "authenticated";

-- is_round_editorを参照するポリシーがなくなった。呼び出し元はすべてSECURITY DEFINERのRPC（所有者postgres）のため、
-- authenticatedのEXECUTEは不要。is_round_memberはSELECTポリシーが使うため維持する。
REVOKE EXECUTE ON FUNCTION "public"."is_round_editor"("target_round_id" "uuid") FROM "authenticated";

commit;

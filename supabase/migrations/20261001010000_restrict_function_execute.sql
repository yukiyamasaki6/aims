begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- issue621: publicの関数のEXECUTEを必要なロールだけに絞り、anonなどに開いている実行権限を閉じる。
-- 関数の作成時に自動で付くPUBLICのEXECUTEが、anon・authenticatedへの実効権限になっている。
-- service_roleとSECURITY DEFINER関数（所有者postgres）の権限には影響しない。

-- トリガー関数: EXECUTE権限はCREATE TRIGGERの時点で検査され、発火時の呼び出しロールには要求されない。
-- どのAPIロールにも直接呼ばせる必要がないため、すべて剥奪する。
REVOKE EXECUTE ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, "anon", "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."set_updated_at"() FROM PUBLIC, "anon", "authenticated";

-- RLSポリシーから呼ばれるヘルパー: ポリシーが適用されるauthenticatedにだけ必要。
-- anonに向けたポリシーはなく、anonのテーブル権限もないため、anonには不要。
REVOKE EXECUTE ON FUNCTION "public"."is_round_editor"("target_round_id" "uuid") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."is_round_editor"("target_round_id" "uuid") TO "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."is_round_member"("target_round_id" "uuid") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."is_round_member"("target_round_id" "uuid") TO "authenticated";

-- RPC: 他のRPCと同様に、PUBLICとanonから剥奪し、authenticatedにだけ付ける。
REVOKE EXECUTE ON FUNCTION "public"."save_round_as_preset"("p_name" "text", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."save_round_as_preset"("p_name" "text", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") TO "authenticated";

-- 今後作る関数への自動付与を止めるALTER DEFAULT PRIVILEGESは、全スキーマに影響し得るため行わない。
-- 新しい関数のEXECUTEは、rls_matrix.sqlの関数権限の網羅性ガードが検出する。

commit;

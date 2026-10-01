begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- issue620: anon・authenticatedに付いている不要なテーブルGRANTを閉じ、検証すべき権限の面を最小にする。
-- 旧方針（GRANTは維持しRLSで拒否する）を改め、書き込みポリシーのない操作はGRANTの剥奪により
-- row-level securityエラーではなくpermission denied（42501）で拒否する。
-- TRUNCATE等はRLSを通らないため、どのテーブルでもanon・authenticatedには付けない。
-- service_roleとSECURITY DEFINER関数（所有者postgres）の権限には影響しない。

-- anon: 公開前のリクエストが直接触るテーブルはないため、全権限を剥奪する。
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "anon";

-- authenticated: 一度全権限を剥奪し、必要な権限だけを付け直す。
-- 現在のGRANTの状態に依らず、移行後の権限を常に同じ状態にするため。
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "authenticated";

-- SELECTは全テーブルに付ける（行の可視性はRLSのSELECTポリシーで制御する）。
GRANT SELECT ON TABLE
  "public"."users",
  "public"."target_faces",
  "public"."target_face_spots",
  "public"."target_face_rings",
  "public"."preset_rounds",
  "public"."preset_distances",
  "public"."rounds",
  "public"."distances",
  "public"."shots",
  "public"."round_users",
  "public"."round_events",
  "public"."distance_events",
  "public"."shot_events"
TO "authenticated";

-- INSERT/UPDATE/DELETEは、対応するRLSの書き込みポリシーがあるテーブル・操作だけに付ける。
-- rounds/distances/shots/round_events/distance_events/shot_eventsの書き込みはSECURITY DEFINERのRPC経由のみで、
-- 直接の書き込みポリシーがないため付けない。
GRANT INSERT, UPDATE, DELETE ON TABLE
  "public"."round_users",
  "public"."preset_rounds",
  "public"."preset_distances",
  "public"."target_faces",
  "public"."target_face_spots",
  "public"."target_face_rings"
TO "authenticated";

-- usersの行はhandle_new_userトリガー（SECURITY DEFINER）が作るため、INSERTのポリシーはなくUPDATE/DELETEだけ付ける。
GRANT UPDATE, DELETE ON TABLE "public"."users" TO "authenticated";

-- postgresロールが今後publicに作るテーブルに、anon・authenticatedへの権限が自動で付かないようにする。
-- 新しいテーブルには、必要な権限を明示的にGRANTする。service_roleの既定権限は変更しない。
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated";

commit;

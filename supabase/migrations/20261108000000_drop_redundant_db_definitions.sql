-- 行を作るのはRPCだけで、形はRPCのinsert文が決めるため、DBの制約と付与とコメントのうち、効いていないものを外す。
--   - イベント3表の*_payload_by_type(CHECK)
--   - round_users.round_idの外部キーの遅延検査(create_roundはroundsを先に入れる)
--   - service_roleへのREFERENCES,TRIGGER,TRUNCATE,MAINTAINの付与(13表)
--   - 列のコメント(9列)

begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

ALTER TABLE "public"."distance_events" DROP CONSTRAINT "distance_events_payload_by_type";
ALTER TABLE "public"."round_events" DROP CONSTRAINT "round_events_payload_by_type";
ALTER TABLE "public"."shot_events" DROP CONSTRAINT "shot_events_payload_by_type";

ALTER TABLE "public"."round_users" ALTER CONSTRAINT "round_users_round_id_fkey" NOT DEFERRABLE;

REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."users" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."target_faces" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."target_face_spots" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."target_face_rings" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."preset_rounds" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."preset_distances" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."rounds" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."distances" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."shots" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."round_users" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."round_events" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."distance_events" FROM "service_role";
REVOKE REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE "public"."shot_events" FROM "service_role";

COMMENT ON COLUMN "public"."distance_events"."set_fields" IS NULL;
COMMENT ON COLUMN "public"."round_events"."set_fields" IS NULL;
COMMENT ON COLUMN "public"."round_events"."status" IS NULL;
COMMENT ON COLUMN "public"."rounds"."status" IS NULL;
COMMENT ON COLUMN "public"."shot_events"."shot_id" IS NULL;
COMMENT ON COLUMN "public"."shot_events"."shot_number" IS NULL;
COMMENT ON COLUMN "public"."shot_events"."set_fields" IS NULL;
COMMENT ON COLUMN "public"."shots"."id" IS NULL;
COMMENT ON COLUMN "public"."shots"."shot_number" IS NULL;

commit;

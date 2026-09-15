begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

-- round_events/distance_events/shot_eventsのcreated_atは、同一トランザクション
-- 内の複数INSERT（例: create_roundが複数distance_eventsを1トランザクションで
-- 挿入する）でも順序が失われないよう既にclock_timestamp()を既定値にしている
-- （issue460）。updated_atだけがnow()（トランザクション開始時刻で固定）のまま
-- だったため、作成直後のupdated_atがcreated_atより前になり得る意味的な不整合
-- があった。同じ理由でupdated_atの既定値もclock_timestamp()に揃える。

ALTER TABLE "public"."round_events" ALTER COLUMN "updated_at" SET DEFAULT "clock_timestamp"();
ALTER TABLE "public"."distance_events" ALTER COLUMN "updated_at" SET DEFAULT "clock_timestamp"();
ALTER TABLE "public"."shot_events" ALTER COLUMN "updated_at" SET DEFAULT "clock_timestamp"();

commit;

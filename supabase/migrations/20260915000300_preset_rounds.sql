begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

CREATE TABLE IF NOT EXISTS "public"."preset_distances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "preset_id" "uuid" NOT NULL,
    "distance" bigint,
    "total_ends" bigint NOT NULL,
    "arrows_per_end" bigint NOT NULL,
    "target_face_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_marked" boolean DEFAULT true NOT NULL,
    "position_key" "text" NOT NULL COLLATE "pg_catalog"."C",
    CONSTRAINT "preset_distances_arrows_per_end_positive" CHECK (("arrows_per_end" >= 1)),
    CONSTRAINT "preset_distances_distance_positive" CHECK ((("distance" IS NULL) OR ("distance" >= 1))),
    CONSTRAINT "preset_distances_marked_requires_distance" CHECK ((("is_marked" = false) OR ("distance" IS NOT NULL))),
    CONSTRAINT "preset_distances_total_ends_positive" CHECK (("total_ends" >= 1))
);


CREATE TABLE IF NOT EXISTS "public"."preset_rounds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "owner_id" "uuid",
    "name" "text" NOT NULL,
    "format" "text" NOT NULL,
    "bow_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "preset_rounds_bow_type_check" CHECK (("bow_type" = ANY (ARRAY['recurve'::"text", 'compound'::"text", 'barebow'::"text"]))),
    CONSTRAINT "preset_rounds_format_check" CHECK (("format" = ANY (ARRAY['outdoor'::"text", 'indoor'::"text", 'field'::"text"]))),
    CONSTRAINT "preset_rounds_name_length" CHECK (("char_length"("name") <= 50))
);


ALTER TABLE "public"."preset_distances" OWNER TO "postgres";


ALTER TABLE "public"."preset_rounds" OWNER TO "postgres";


--
-- Data for Name: preset_rounds; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."preset_rounds" ("id", "owner_id", "name", "format", "bow_type", "created_at", "updated_at") VALUES
	('a3000000-0000-0000-0000-000000000001', NULL, 'WA 1440', 'outdoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00'),
	('a3000000-0000-0000-0000-000000000002', NULL, '70m (720)', 'outdoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00'),
	('a3000000-0000-0000-0000-000000000003', NULL, '50m (720)', 'outdoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00'),
	('a3000000-0000-0000-0000-000000000004', NULL, '30m (720)', 'outdoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00'),
	('a3000000-0000-0000-0000-000000000005', NULL, '50m / 30m (720)', 'outdoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00'),
	('a3000000-0000-0000-0000-000000000006', NULL, '70m (360)', 'outdoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00'),
	('a3000000-0000-0000-0000-000000000007', NULL, '50m (360)', 'outdoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00'),
	('a3000000-0000-0000-0000-000000000008', NULL, '30m (360)', 'outdoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00'),
	('a3000000-0000-0000-0000-000000000009', NULL, '18m (600)', 'indoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00'),
	('a3000000-0000-0000-0000-000000000010', NULL, '18m (300)', 'indoor', 'recurve', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:23.770849+00');


--
-- Data for Name: preset_distances; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."preset_distances" ("id", "preset_id", "distance", "total_ends", "arrows_per_end", "target_face_id", "created_at", "updated_at", "is_marked", "position_key") VALUES
	('65447ddb-2503-431c-b447-e5978e975b07', 'a3000000-0000-0000-0000-000000000001', 90, 6, 6, 'a1000000-0000-0000-0000-000000000001', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.71347+00', true, '000000000001'),
	('93377d8b-d64b-4bba-9417-46e3cf7478de', 'a3000000-0000-0000-0000-000000000001', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713527+00', true, '000000000002'),
	('b1aab005-d4e7-4079-88e6-8221b1b41dc0', 'a3000000-0000-0000-0000-000000000001', 50, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713535+00', true, '000000000003'),
	('66f03f16-efcd-443a-a487-7ed09223fb1c', 'a3000000-0000-0000-0000-000000000001', 30, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.71354+00', true, '000000000004'),
	('e2994e81-9b81-42b7-8d5d-ea2bfaf15c1b', 'a3000000-0000-0000-0000-000000000002', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713546+00', true, '000000000001'),
	('1803e041-1de6-4948-b28a-df5524c3d542', 'a3000000-0000-0000-0000-000000000002', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713551+00', true, '000000000002'),
	('b596af31-bbbc-41ff-87d6-10bb256f65e7', 'a3000000-0000-0000-0000-000000000003', 50, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713556+00', true, '000000000001'),
	('d4972da7-2a46-486c-a730-5f44d6d05ecd', 'a3000000-0000-0000-0000-000000000003', 50, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713561+00', true, '000000000002'),
	('dec7aaab-f9e6-44b1-87a2-0a635cb15129', 'a3000000-0000-0000-0000-000000000004', 30, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713566+00', true, '000000000001'),
	('9a36de49-e2b8-4489-83b4-6048966b63fd', 'a3000000-0000-0000-0000-000000000004', 30, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713571+00', true, '000000000002'),
	('3401bf63-e327-4ffa-aee1-72a5eda1548f', 'a3000000-0000-0000-0000-000000000005', 50, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713576+00', true, '000000000001'),
	('2c248c19-735a-4de5-8748-42090b4c9ab3', 'a3000000-0000-0000-0000-000000000005', 30, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713581+00', true, '000000000002'),
	('6609159c-67fd-4a4d-ad56-808aa77d3e68', 'a3000000-0000-0000-0000-000000000006', 70, 6, 6, 'a1000000-0000-0000-0000-000000000001', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713586+00', true, '000000000001'),
	('e0ef9b4c-920e-40e1-badc-40c0739effe1', 'a3000000-0000-0000-0000-000000000007', 50, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713592+00', true, '000000000001'),
	('51e480f6-b93e-4f2e-92db-da3d97524087', 'a3000000-0000-0000-0000-000000000008', 30, 6, 6, 'a1000000-0000-0000-0000-000000000002', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713597+00', true, '000000000001'),
	('ca18984b-61cc-46a3-8f6b-7ab983d0bf42', 'a3000000-0000-0000-0000-000000000009', 18, 10, 3, 'a1000000-0000-0000-0000-000000000007', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713602+00', true, '000000000001'),
	('b40050a4-13a0-4bbe-a0fb-b7c957c5e99d', 'a3000000-0000-0000-0000-000000000009', 18, 10, 3, 'a1000000-0000-0000-0000-000000000007', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713607+00', true, '000000000002'),
	('86a3eb50-89a8-4498-a58e-66ab1f49f052', 'a3000000-0000-0000-0000-000000000010', 18, 10, 3, 'a1000000-0000-0000-0000-000000000007', '2026-09-14 15:04:23.770849+00', '2026-09-14 15:04:25.713612+00', true, '000000000001');


ALTER TABLE ONLY "public"."preset_distances"
    ADD CONSTRAINT "preset_distances_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "public"."preset_rounds"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."preset_distances"
    ADD CONSTRAINT "preset_distances_target_face_id_fkey" FOREIGN KEY ("target_face_id") REFERENCES "public"."target_faces"("id");


ALTER TABLE ONLY "public"."preset_rounds"
    ADD CONSTRAINT "preset_rounds_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;


CREATE OR REPLACE TRIGGER "set_preset_distances_updated_at" BEFORE UPDATE ON "public"."preset_distances" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_preset_rounds_updated_at" BEFORE UPDATE ON "public"."preset_rounds" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE FUNCTION "public"."save_round_as_preset"("p_round_id" "uuid", "p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_format text;
  v_bow_type text;
  v_preset_id uuid;
begin
  select format, bow_type into v_format, v_bow_type
  from rounds
  where id = p_round_id;

  if not found then
    raise exception 'ラウンドの取得に失敗しました。';
  end if;

  insert into preset_rounds (owner_id, name, format, bow_type)
  values (auth.uid(), p_name, v_format, v_bow_type)
  returning id into v_preset_id;

  insert into preset_distances (
    preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked
  )
  select v_preset_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked
  from distances
  where round_id = p_round_id
  order by position_key, id;

  return v_preset_id;
end;
$$;


ALTER FUNCTION "public"."save_round_as_preset"("p_round_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE POLICY "delete_if_owner" ON "public"."preset_distances" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."preset_rounds" "rp"
  WHERE (("rp"."id" = "preset_distances"."preset_id") AND ("rp"."owner_id" = "auth"."uid"())))));


CREATE POLICY "delete_own" ON "public"."preset_rounds" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));


CREATE POLICY "insert_if_owner" ON "public"."preset_distances" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."preset_rounds" "rp"
  WHERE (("rp"."id" = "preset_distances"."preset_id") AND ("rp"."owner_id" = "auth"."uid"())))));


CREATE POLICY "insert_own" ON "public"."preset_rounds" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));


ALTER TABLE "public"."preset_distances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."preset_rounds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_all_authenticated" ON "public"."preset_distances" FOR SELECT TO "authenticated" USING (true);


CREATE POLICY "select_all_authenticated" ON "public"."preset_rounds" FOR SELECT TO "authenticated" USING (true);


CREATE POLICY "update_if_owner" ON "public"."preset_distances" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."preset_rounds" "rp"
  WHERE (("rp"."id" = "preset_distances"."preset_id") AND ("rp"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."preset_rounds" "rp"
  WHERE (("rp"."id" = "preset_distances"."preset_id") AND ("rp"."owner_id" = "auth"."uid"())))));


CREATE POLICY "update_own" ON "public"."preset_rounds" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));


GRANT EXECUTE ON FUNCTION "public"."save_round_as_preset"("p_round_id" "uuid", "p_name" "text") TO "authenticated";


GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."preset_distances" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preset_distances" TO "service_role";


GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."preset_rounds" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."preset_rounds" TO "service_role";

commit;

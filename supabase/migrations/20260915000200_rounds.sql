begin;

set lock_timeout = '1s';
set statement_timeout = '5s';

CREATE TABLE IF NOT EXISTS "public"."distances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "round_id" "uuid" NOT NULL,
    "distance" bigint,
    "total_ends" bigint NOT NULL,
    "arrows_per_end" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_face_id" "uuid" NOT NULL,
    "is_marked" boolean DEFAULT true NOT NULL,
    "position_key" "text" NOT NULL COLLATE "pg_catalog"."C",
    CONSTRAINT "distances_arrows_per_end_positive" CHECK (("arrows_per_end" >= 1)),
    CONSTRAINT "distances_distance_positive" CHECK ((("distance" IS NULL) OR ("distance" >= 1))),
    CONSTRAINT "distances_marked_requires_distance" CHECK ((("is_marked" = false) OR ("distance" IS NOT NULL))),
    CONSTRAINT "distances_total_ends_positive" CHECK (("total_ends" >= 1))
);


CREATE TABLE IF NOT EXISTS "public"."round_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "round_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "round_users_role_check" CHECK (("role" = ANY (ARRAY['editor'::"text", 'viewer'::"text"])))
);


CREATE TABLE IF NOT EXISTS "public"."rounds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "name" "text" NOT NULL,
    "round_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "format" "text" NOT NULL,
    "bow_type" "text" NOT NULL,
    CONSTRAINT "rounds_bow_type_check" CHECK (("bow_type" = ANY (ARRAY['recurve'::"text", 'compound'::"text", 'barebow'::"text"]))),
    CONSTRAINT "rounds_format_check" CHECK (("format" = ANY (ARRAY['outdoor'::"text", 'indoor'::"text", 'field'::"text"]))),
    CONSTRAINT "rounds_name_length" CHECK (("char_length"("name") <= 50))
);


CREATE TABLE IF NOT EXISTS "public"."shots" (
    "distance_id" "uuid" NOT NULL,
    "end_number" bigint NOT NULL,
    "arrow_number" bigint NOT NULL,
    "shooter_id" "uuid" NOT NULL,
    "score_str" "text" NOT NULL,
    "score_int" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shots_pkey" PRIMARY KEY ("distance_id", "end_number", "arrow_number")
);


ALTER TABLE "public"."distances" OWNER TO "postgres";


ALTER TABLE "public"."round_users" OWNER TO "postgres";


ALTER TABLE "public"."rounds" OWNER TO "postgres";


ALTER TABLE "public"."shots" OWNER TO "postgres";


ALTER TABLE ONLY "public"."round_users"
    ADD CONSTRAINT "round_users_round_id_user_id_key" UNIQUE ("round_id", "user_id");


ALTER TABLE ONLY "public"."distances"
    ADD CONSTRAINT "distances_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."distances"
    ADD CONSTRAINT "distances_target_face_id_fkey" FOREIGN KEY ("target_face_id") REFERENCES "public"."target_faces"("id");


ALTER TABLE ONLY "public"."round_users"
    ADD CONSTRAINT "round_users_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;


ALTER TABLE ONLY "public"."round_users"
    ADD CONSTRAINT "round_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."shots"
    ADD CONSTRAINT "shots_distance_id_fkey" FOREIGN KEY ("distance_id") REFERENCES "public"."distances"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."shots"
    ADD CONSTRAINT "shots_shooter_id_fkey" FOREIGN KEY ("shooter_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;


CREATE OR REPLACE TRIGGER "set_distances_updated_at" BEFORE UPDATE ON "public"."distances" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_round_users_updated_at" BEFORE UPDATE ON "public"."round_users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_rounds_updated_at" BEFORE UPDATE ON "public"."rounds" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE TRIGGER "set_shots_updated_at" BEFORE UPDATE ON "public"."shots" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


CREATE OR REPLACE FUNCTION "public"."create_round"("p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_round_id uuid := gen_random_uuid();
  v_distance jsonb;
  v_position_index bigint := 0;
begin
  insert into round_users (round_id, user_id, role)
  values (v_round_id, auth.uid(), 'editor');

  insert into rounds (id, name, round_date, format, bow_type)
  values (v_round_id, p_name, p_round_date, p_format, p_bow_type);

  for v_distance in select * from jsonb_array_elements(p_distances)
  loop
    v_position_index := v_position_index + 1;
    insert into distances (round_id, position_key, distance, total_ends, arrows_per_end, target_face_id, is_marked)
    values (
      v_round_id,
      lpad(v_position_index::text, 12, '0'),
      (v_distance ->> 'distance')::bigint,
      (v_distance ->> 'total_ends')::bigint,
      (v_distance ->> 'arrows_per_end')::bigint,
      (v_distance ->> 'target_face_id')::uuid,
      coalesce((v_distance ->> 'is_marked')::boolean, true)
    );
  end loop;

  return v_round_id;
end;
$$;


ALTER FUNCTION "public"."create_round"("p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_round_editor"("target_round_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from round_users ru
    where ru.round_id = target_round_id and ru.user_id = auth.uid() and ru.role = 'editor'
  );
$$;


ALTER FUNCTION "public"."is_round_editor"("target_round_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_round_member"("target_round_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from round_users ru
    where ru.round_id = target_round_id and ru.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_round_member"("target_round_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_distance"("p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_has_shots boolean;
begin
  select exists (
    select 1 from shots where distance_id = p_distance_id
  ) into v_has_shots;

  -- shotsが1件でも存在する距離は、総エンド数・エンドあたりの本数に加えて
  -- 的（target_face_id）も変更させない。的の種類が変わると点数の意味も
  -- 変わってしまい、既に記録済みのshotsと整合しなくなるため（UI側でも
  -- 読み取り専用にしているが、ここでも防御的に無視する）。distance・
  -- is_markedは点数構成に関係しないメタ情報なので、shots有無にかかわらず
  -- 常に変更できる。
  if v_has_shots then
    update distances
    set distance = p_distance, is_marked = p_is_marked
    where id = p_distance_id;
  else
    update distances
    set
      distance = p_distance,
      total_ends = p_total_ends,
      arrows_per_end = p_arrows_per_end,
      target_face_id = p_target_face_id,
      is_marked = p_is_marked
    where id = p_distance_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."update_distance"("p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_round_config"("p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if p_format <> 'field' and exists (
    select 1 from distances
    where round_id = p_round_id and is_marked = false
  ) then
    raise exception 'Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。';
  end if;

  update rounds
  set name = p_name, round_date = p_round_date, format = p_format, bow_type = p_bow_type
  where id = p_round_id;
end;
$$;


ALTER FUNCTION "public"."update_round_config"("p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE POLICY "delete_if_editor" ON "public"."distances" FOR DELETE TO "authenticated" USING ("public"."is_round_editor"("round_id"));


CREATE POLICY "delete_if_editor" ON "public"."round_users" FOR DELETE TO "authenticated" USING ("public"."is_round_editor"("round_id"));


CREATE POLICY "delete_if_editor" ON "public"."rounds" FOR DELETE TO "authenticated" USING ("public"."is_round_editor"("id"));


CREATE POLICY "delete_if_editor" ON "public"."shots" FOR DELETE TO "authenticated" USING ("public"."is_round_editor"(( SELECT "d"."round_id"
   FROM "public"."distances" "d"
  WHERE ("d"."id" = "shots"."distance_id"))));


ALTER TABLE "public"."distances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert_if_editor" ON "public"."distances" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_round_editor"("round_id"));


CREATE POLICY "insert_if_editor" ON "public"."round_users" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_round_editor"("round_id"));


CREATE POLICY "insert_if_editor" ON "public"."shots" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_round_editor"(( SELECT "d"."round_id"
   FROM "public"."distances" "d"
  WHERE ("d"."id" = "shots"."distance_id"))));


ALTER TABLE "public"."round_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rounds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_if_member" ON "public"."distances" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("round_id"));


CREATE POLICY "select_if_member" ON "public"."round_users" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("round_id"));


CREATE POLICY "select_if_member" ON "public"."rounds" FOR SELECT TO "authenticated" USING ("public"."is_round_member"("id"));


CREATE POLICY "select_if_member" ON "public"."shots" FOR SELECT TO "authenticated" USING ("public"."is_round_member"(( SELECT "d"."round_id"
   FROM "public"."distances" "d"
  WHERE ("d"."id" = "shots"."distance_id"))));


ALTER TABLE "public"."shots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update_if_editor" ON "public"."distances" FOR UPDATE TO "authenticated" USING ("public"."is_round_editor"("round_id")) WITH CHECK ("public"."is_round_editor"("round_id"));


CREATE POLICY "update_if_editor" ON "public"."round_users" FOR UPDATE TO "authenticated" USING ("public"."is_round_editor"("round_id")) WITH CHECK ("public"."is_round_editor"("round_id"));


CREATE POLICY "update_if_editor" ON "public"."rounds" FOR UPDATE TO "authenticated" USING ("public"."is_round_editor"("id")) WITH CHECK ("public"."is_round_editor"("id"));


CREATE POLICY "update_if_editor" ON "public"."shots" FOR UPDATE TO "authenticated" USING ("public"."is_round_editor"(( SELECT "d"."round_id"
   FROM "public"."distances" "d"
  WHERE ("d"."id" = "shots"."distance_id")))) WITH CHECK ("public"."is_round_editor"(( SELECT "d"."round_id"
   FROM "public"."distances" "d"
  WHERE ("d"."id" = "shots"."distance_id"))));


GRANT EXECUTE ON FUNCTION "public"."create_round"("p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text", "p_distances" "jsonb") TO "authenticated";


GRANT EXECUTE ON FUNCTION "public"."update_distance"("p_distance_id" "uuid", "p_distance" bigint, "p_total_ends" bigint, "p_arrows_per_end" bigint, "p_target_face_id" "uuid", "p_is_marked" boolean) TO "authenticated";


GRANT EXECUTE ON FUNCTION "public"."update_round_config"("p_round_id" "uuid", "p_name" "text", "p_round_date" "date", "p_format" "text", "p_bow_type" "text") TO "authenticated";


GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."distances" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."distances" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."distances" TO "service_role";


GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."round_users" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."round_users" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."round_users" TO "service_role";


GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."rounds" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."rounds" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."rounds" TO "service_role";


GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."shots" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."shots" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."shots" TO "service_role";

commit;

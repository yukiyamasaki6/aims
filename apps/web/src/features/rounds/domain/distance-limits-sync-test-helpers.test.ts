import { describe, expect, it } from "vitest";
import { readLimitsFromMigrations } from "./distance-limits-sync-test-helpers";

type Limits = {
  distances: [number, number, number];
  presetDistances: [number, number, number];
  overLimit: [number, number, number];
};

// pg_dumpの書式(識別子の引用符、二重の括弧、coalesce)で、6本の制約と判定関数を書いたSQL。
function migration(limits: Limits): string {
  const [distance, totalEnds, arrowsPerEnd] = limits.distances;
  const [presetDistance, presetTotalEnds, presetArrowsPerEnd] =
    limits.presetDistances;
  const [overDistance, overTotalEnds, overArrowsPerEnd] = limits.overLimit;
  return `
ALTER TABLE "public"."distances" ADD CONSTRAINT "distances_distance_max" CHECK ((("distance" IS NULL) OR ("distance" <= ${distance})));
ALTER TABLE "public"."distances" ADD CONSTRAINT "distances_total_ends_max" CHECK (("total_ends" <= ${totalEnds}));
ALTER TABLE "public"."distances" ADD CONSTRAINT "distances_arrows_per_end_max" CHECK (("arrows_per_end" <= ${arrowsPerEnd}));
ALTER TABLE "public"."preset_distances" ADD CONSTRAINT "preset_distances_distance_max" CHECK ((("distance" IS NULL) OR ("distance" <= ${presetDistance})));
ALTER TABLE "public"."preset_distances" ADD CONSTRAINT "preset_distances_total_ends_max" CHECK (("total_ends" <= ${presetTotalEnds}));
ALTER TABLE "public"."preset_distances" ADD CONSTRAINT "preset_distances_arrows_per_end_max" CHECK (("arrows_per_end" <= ${presetArrowsPerEnd}));
CREATE OR REPLACE FUNCTION "public"."distance_config_over_limit"("p_distance" numeric, "p_total_ends" numeric, "p_arrows_per_end" numeric) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select coalesce(p_distance > ${overDistance}, false)
    or coalesce(p_total_ends > ${overTotalEnds}, false)
    or coalesce(p_arrows_per_end > ${overArrowsPerEnd}, false);
$$;
`;
}

const same: Limits = {
  distances: [100, 100, 12],
  presetDistances: [100, 100, 12],
  overLimit: [100, 100, 12],
};

describe("readLimitsFromMigrations", () => {
  describe("読める場合", () => {
    it("制約6本の上限と、判定関数の3つのリテラルを、項目ごとに別の値として読む", () => {
      // Given
      // 項目の取り違えを検出できるよう、全ての値を別にする。
      const sql = migration({
        distances: [1, 2, 3],
        presetDistances: [4, 5, 6],
        overLimit: [7, 8, 9],
      });

      // When
      const limits = readLimitsFromMigrations([sql]);

      // Then
      expect(limits).toEqual({
        constraints: {
          distances_distance_max: 1,
          distances_total_ends_max: 2,
          distances_arrows_per_end_max: 3,
          preset_distances_distance_max: 4,
          preset_distances_total_ends_max: 5,
          preset_distances_arrows_per_end_max: 6,
        },
        overLimit: { distance: 7, totalEnds: 8, arrowsPerEnd: 9 },
      });
    });

    it("引用符のない書式の制約と、unquotedな関数の定義も読む", () => {
      // Given
      const sql = `
ALTER TABLE public.distances ADD CONSTRAINT distances_distance_max CHECK (distance IS NULL OR distance <= 100);
ALTER TABLE public.distances ADD CONSTRAINT distances_total_ends_max CHECK (total_ends <= 100) NOT VALID;
ALTER TABLE ONLY public.distances ADD CONSTRAINT distances_arrows_per_end_max CHECK (arrows_per_end <= 12);
ALTER TABLE public.preset_distances ADD CONSTRAINT preset_distances_distance_max CHECK (distance <= 100);
ALTER TABLE public.preset_distances ADD CONSTRAINT preset_distances_total_ends_max CHECK (total_ends <= 100);
ALTER TABLE public.preset_distances ADD CONSTRAINT preset_distances_arrows_per_end_max CHECK (arrows_per_end <= 12);
create function distance_config_over_limit(p_distance numeric, p_total_ends numeric, p_arrows_per_end numeric)
returns boolean language sql as $body$
  select p_distance > 100 or p_total_ends > 100 or p_arrows_per_end > 12;
$body$;
`;

      // When
      const limits = readLimitsFromMigrations([sql]);

      // Then
      expect(Object.values(limits.constraints)).toEqual([
        100, 100, 12, 100, 100, 12,
      ]);
      expect(limits.overLimit).toEqual({
        distance: 100,
        totalEnds: 100,
        arrowsPerEnd: 12,
      });
    });

    it("同じ制約や関数を後のマイグレーションで定義し直したら、最後の定義の値を使う", () => {
      // Given
      const first = migration(same);
      const redefine = `
ALTER TABLE "public"."distances" DROP CONSTRAINT "distances_distance_max";
ALTER TABLE "public"."distances" ADD CONSTRAINT "distances_distance_max" CHECK ((("distance" IS NULL) OR ("distance" <= 50)));
CREATE OR REPLACE FUNCTION "public"."distance_config_over_limit"("p_distance" numeric, "p_total_ends" numeric, "p_arrows_per_end" numeric) RETURNS boolean
    LANGUAGE "sql" AS $$
  select coalesce(p_distance > 50, false)
    or coalesce(p_total_ends > 100, false)
    or coalesce(p_arrows_per_end > 12, false);
$$;
`;

      // When
      const limits = readLimitsFromMigrations([first, redefine]);

      // Then
      expect(limits.constraints.distances_distance_max).toBe(50);
      expect(limits.overLimit.distance).toBe(50);
    });

    it("コメントや文字列に書かれた上限の式は拾わない", () => {
      // Given
      const sql = `
-- ALTER TABLE "public"."distances" ADD CONSTRAINT "distances_distance_max" CHECK (("distance" <= 999));
/* create function distance_config_over_limit(p_distance numeric) as $$ select p_distance > 999 $$; */
${migration(same).replace(
  "select coalesce(p_distance > 100, false)",
  "select 'p_distance > 999' is null or coalesce(p_distance > 100, false) -- p_distance > 888",
)}
`;

      // When
      const limits = readLimitsFromMigrations([sql]);

      // Then
      expect(limits.constraints.distances_distance_max).toBe(100);
      expect(limits.overLimit.distance).toBe(100);
    });
  });

  describe("読めない場合", () => {
    it("マイグレーションが1つも無いと、失敗する", () => {
      // Given
      // When
      const read = () => readLimitsFromMigrations([]);

      // Then
      expect(read).toThrow("SQLが1つも読めない");
    });

    it.each([
      ["distances_distance_max"],
      ["distances_total_ends_max"],
      ["distances_arrows_per_end_max"],
      ["preset_distances_distance_max"],
      ["preset_distances_total_ends_max"],
      ["preset_distances_arrows_per_end_max"],
    ])("制約%sが見つからないと、制約名を示して失敗する", (name) => {
      // Given
      const withoutConstraint = migration(same)
        .split("\n")
        .filter((line) => !line.includes(`"${name}"`))
        .join("\n");

      // When
      const read = () => readLimitsFromMigrations([withoutConstraint]);

      // Then
      expect(read).toThrow(name);
    });

    it("制約が後のマイグレーションでDROPされ、再び追加されていないと、失敗する", () => {
      // Given
      const dropped = `ALTER TABLE "public"."distances" DROP CONSTRAINT IF EXISTS "distances_total_ends_max";`;

      // When
      const read = () => readLimitsFromMigrations([migration(same), dropped]);

      // Then
      expect(read).toThrow("distances_total_ends_max");
    });

    it.each([
      ["比較が<=でない", `"total_ends" < 100`],
      ["上限が数値でない", `"total_ends" <= "arrows_per_end"`],
      ["別の列を比べている", `"arrows_per_end" <= 100`],
      ["上限が型変換を伴う", `"total_ends" <= (100)::bigint`],
    ])(
      "制約のCHECKが読めない形(%s)だと、制約名を示して失敗する",
      (_label, check) => {
        // Given
        const unreadable = migration(same).replace(
          `CHECK (("total_ends" <= 100));`,
          `CHECK ((${check}));`,
        );

        // When
        const read = () => readLimitsFromMigrations([unreadable]);

        // Then
        expect(read).toThrow("distances_total_ends_max");
      },
    );

    it("制約が別の表に付いていると、失敗する", () => {
      // Given
      const wrongTable = migration(same).replace(
        `"public"."distances" ADD CONSTRAINT "distances_total_ends_max"`,
        `"public"."preset_distances" ADD CONSTRAINT "distances_total_ends_max"`,
      );

      // When
      const read = () => readLimitsFromMigrations([wrongTable]);

      // Then
      expect(read).toThrow("distances_total_ends_max");
    });

    it("判定関数が無いと、関数名を示して失敗する", () => {
      // Given
      const withoutFunction = migration(same).split("CREATE OR REPLACE")[0];

      // When
      const read = () => readLimitsFromMigrations([withoutFunction]);

      // Then
      expect(read).toThrow("distance_config_over_limit");
    });

    it("判定関数が後のマイグレーションでDROPされていると、失敗する", () => {
      // Given
      const dropped = `DROP FUNCTION IF EXISTS "public"."distance_config_over_limit"(numeric, numeric, numeric);`;

      // When
      const read = () => readLimitsFromMigrations([migration(same), dropped]);

      // Then
      expect(read).toThrow("distance_config_over_limit");
    });

    it.each([
      ["p_distance", "p_distance > 100", "p_distance > p_total_ends"],
      ["p_total_ends", "p_total_ends > 100", "p_total_ends >= 100"],
      ["p_arrows_per_end", "p_arrows_per_end > 12", "p_arrows_per_end is null"],
    ])(
      "判定関数で%sに対するリテラルが取れないと、引数名を示して失敗する",
      (argument, literal, unreadable) => {
        // Given
        const broken = migration(same).replace(literal, unreadable);

        // When
        const read = () => readLimitsFromMigrations([broken]);

        // Then
        expect(read).toThrow(argument);
      },
    );

    it("判定関数で同じ引数に対するリテラルが複数あると、1つに決まらず失敗する", () => {
      // Given
      const ambiguous = migration(same).replace(
        "or coalesce(p_total_ends > 100, false)",
        "or coalesce(p_total_ends > 100, false) or p_total_ends > 200",
      );

      // When
      const read = () => readLimitsFromMigrations([ambiguous]);

      // Then
      expect(read).toThrow("p_total_ends");
    });

    it("判定関数の本体の区切りが読めないと、失敗する", () => {
      // Given
      const noBody = `${migration(same).split("AS $$")[0]} AS select 1;`;
      const unterminated = `${migration(same).split("$$;")[0]}`;

      // When
      const readNoBody = () => readLimitsFromMigrations([noBody]);
      const readUnterminated = () => readLimitsFromMigrations([unterminated]);

      // Then
      expect(readNoBody).toThrow("distance_config_over_limit");
      expect(readUnterminated).toThrow("distance_config_over_limit");
    });
  });
});

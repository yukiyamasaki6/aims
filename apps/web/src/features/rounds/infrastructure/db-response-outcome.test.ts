import { describe, expect, it } from "vitest";
import type { DbResponse } from "@/lib/supabase/contract/database";
import { failureOfResponses } from "./db-response-outcome";

const ok: DbResponse = { data: { id: "a" }, error: null, status: 200 };
const commError: DbResponse = {
  data: null,
  error: { message: "TypeError: Failed to fetch" },
  status: 0,
};
const authError: DbResponse = {
  data: null,
  error: { code: "PGRST301", message: "JWT expired" },
  status: 401,
};
const serverError: DbResponse = {
  data: null,
  error: { code: "XX000", message: "internal" },
  status: 500,
};
const notFoundError: DbResponse = {
  data: null,
  error: { code: "PGRST116", message: "no rows" },
  status: 406,
};

describe("failureOfResponses", () => {
  describe("正常系", () => {
    it("失敗が無ければundefinedを返す", () => {
      // Given

      // When
      const result = failureOfResponses([ok, ok]);

      // Then
      expect(result).toBeUndefined();
    });

    it("PGRST116(406)は、not-foundにする", () => {
      // Given

      // When
      const result = failureOfResponses([notFoundError]);

      // Then
      expect(result).toEqual({ status: "not-found" });
    });

    it.each([
      "TypeError: Failed to fetch",
      "AbortError: signal is aborted without reason",
      "",
    ])(
      "status 0は、error.message(%j)によらず、comm-failureにする",
      (message) => {
        // Given

        // When
        const result = failureOfResponses([
          { data: null, error: { message }, status: 0 },
        ]);

        // Then
        expect(result).toEqual({ status: "comm-failure" });
      },
    );

    it("通信失敗、認証の拒否、その他のエラーの順に優先して、1つの失敗にする", () => {
      // Given

      // When
      const comm = failureOfResponses([serverError, authError, commError]);
      const auth = failureOfResponses([serverError, authError]);
      const other = failureOfResponses([ok, serverError]);

      // Then
      expect(comm).toEqual({ status: "comm-failure" });
      expect(auth).toEqual({ status: "auth-rejected" });
      expect(other).toEqual({ status: "failed" });
    });

    it("その他のエラーは種類によらず先頭を取る(PGRST116が先頭なら、後ろが500でもnot-found)", () => {
      // Given

      // When
      const result = failureOfResponses([notFoundError, serverError]);

      // Then
      expect(result).toEqual({ status: "not-found" });
    });

    // 旧の失敗判定(status === 0 || error)を保つため、errorが無くてもstatus 0は失敗として畳む。
    it("errorがnullのstatus 0の応答も、失敗として畳んでcomm-failureにする", () => {
      // Given
      const silentComm: DbResponse = { data: null, error: null, status: 0 };

      // When
      const result = failureOfResponses([ok, silentComm]);

      // Then
      expect(result).toEqual({ status: "comm-failure" });
    });
  });

  describe("異常系", () => {
    it.each([
      ["401", { code: undefined, message: "unauthorized" }, 401],
      ["PGRST301(status 400)", { code: "PGRST301" }, 400],
    ])("%sは、auth-rejectedにする", (_name, error, status) => {
      // Given

      // When
      const result = failureOfResponses([{ data: null, error, status }]);

      // Then
      expect(result).toEqual({ status: "auth-rejected" });
    });

    it.each([403, 408, 429, 500, 503])(
      "status %dは、DB内部の文言を持たないfailedにする",
      (status) => {
        // Given

        // When
        const result = failureOfResponses([
          {
            data: null,
            error: { code: "42501", message: "permission denied for table x" },
            status,
          },
        ]);

        // Then
        expect(result).toEqual({ status: "failed" });
      },
    );
  });
});

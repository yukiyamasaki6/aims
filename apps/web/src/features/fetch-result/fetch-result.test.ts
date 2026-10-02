import { describe, expect, it } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import { classifyResponse, FETCH_ERROR_MESSAGE } from "./fetch-result";

describe("classifyResponse", () => {
  describe("正常系", () => {
    it("エラーがなければ、dataをokで返す", () => {
      // Given
      const res = { data: { id: "a" }, error: null, status: 200 };

      // When
      const result = classifyResponse(res);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
    });

    it("配列の0件は、nullIsNotFoundの有無によらずokとする", () => {
      // Given
      const res = { data: [], error: null, status: 200 };

      // When / Then
      expect(classifyResponse(res)).toEqual({ status: "ok", data: [] });
      expect(classifyResponse(res, { nullIsNotFound: true })).toEqual({
        status: "ok",
        data: [],
      });
    });

    it("nullIsNotFoundのとき、dataがnullならnot-foundにする", () => {
      // Given
      const res = { data: null, error: null, status: 200 };

      // When
      const result = classifyResponse(res, { nullIsNotFound: true });

      // Then
      expect(result).toEqual({ status: "not-found" });
    });

    it("nullIsNotFoundでないとき、dataのnullはそのままokで返す", () => {
      // Given
      const res = { data: null, error: null, status: 200 };

      // When
      const result = classifyResponse(res);

      // Then
      expect(result).toEqual({ status: "ok", data: null });
    });

    it("PGRST116(406)は、not-foundにする", () => {
      // Given
      const res = { data: null, error: { code: "PGRST116" }, status: 406 };

      // When
      const result = classifyResponse(res);

      // Then
      expect(result).toEqual({ status: "not-found" });
    });
  });

  describe("異常系", () => {
    it.each([
      "TypeError: Failed to fetch",
      "AbortError: signal is aborted without reason",
      "",
    ])("status 0は、error.message(%j)によらずofflineにする", (message) => {
      // Given
      const res = { data: null, error: { message }, status: 0 };

      // When
      const result = classifyResponse(res);

      // Then
      expect(result).toEqual({ status: "offline" });
    });

    it.each([
      ["401", { code: undefined, status: 401 }],
      ["PGRST301", { code: "PGRST301", status: 400 }],
    ])("%sは、サインインが必要なerrorにする", (_name, { code, status }) => {
      // Given
      const res = { data: null, error: { code }, status };

      // When
      const result = classifyResponse(res);

      // Then
      expect(result).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
    });

    it.each([403, 408, 429, 500, 503])(
      "status %dは、DB内部の文言を出さず固定文のerrorにする",
      (status) => {
        // Given
        const res = {
          data: null,
          error: { code: "42501", message: "permission denied for table x" },
          status,
        };

        // When
        const result = classifyResponse(res);

        // Then
        expect(result).toEqual({
          status: "error",
          message: FETCH_ERROR_MESSAGE,
        });
      },
    );
  });
});

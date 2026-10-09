import { describe, expect, it } from "vitest";
import {
  classifyResponse,
  FETCH_ERROR_MESSAGE,
  isAuthRejected,
} from "./fetch-result";

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
    ])(
      "status 0は、error.message(%j)によらず、原因を断定せずerrorにする",
      (message) => {
        // Given
        const res = { data: null, error: { message }, status: 0 };

        // When
        const result = classifyResponse(res);

        // Then
        expect(result).toEqual({
          status: "error",
          message: "読み込めませんでした。",
        });
      },
    );

    it.each([
      ["401", { code: undefined, status: 401 }],
      ["PGRST301", { code: "PGRST301", status: 400 }],
    ])(
      "%sは、取得の側で確かめ終えた後のため、サインインを求めず固定文のerrorにする",
      (_name, { code, status }) => {
        // Given
        const res = { data: null, error: { code }, status };

        // When
        const result = classifyResponse(res);

        // Then
        expect(result).toEqual({
          status: "error",
          message: FETCH_ERROR_MESSAGE,
        });
      },
    );

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

describe("isAuthRejected", () => {
  it("401とPGRST301を認証の拒否とし、それ以外のエラーと成功は含めない", () => {
    // Given
    const rejected = [
      { data: null, error: { code: undefined }, status: 401 },
      { data: null, error: { code: "PGRST301" }, status: 400 },
    ];
    const others = [
      { data: null, error: { code: "42501" }, status: 403 },
      { data: null, error: { message: "Failed to fetch" }, status: 0 },
      { data: { id: "a" }, error: null, status: 200 },
    ];

    // When
    const rejectedResults = rejected.map(isAuthRejected);
    const otherResults = others.map(isAuthRejected);

    // Then
    expect(rejectedResults).toEqual([true, true]);
    expect(otherResults).toEqual([false, false, false]);
  });
});

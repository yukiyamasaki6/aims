import { describe, expect, it } from "vitest";
import {
  classifyResponse,
  commFailure,
  FALLBACK_WAIT_MS,
  FETCH_ERROR_MESSAGE,
  FETCH_TIMEOUT_MS,
  foldFailures,
  isAuthRejected,
  waitLimitMs,
  withFallback,
} from "./fetch-result";

describe("classifyResponse", () => {
  describe("正常系", () => {
    it("エラーがなければ、dataをokで返す", () => {
      // Given
      // When
      const res = { data: { id: "a" }, error: null, status: 200 };
      const result = classifyResponse(res);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
    });

    it("配列の0件は、nullIsNotFoundの有無によらずokとする", () => {
      // Given
      // When
      const res = { data: [], error: null, status: 200 };
      const results = [
        classifyResponse(res),
        classifyResponse(res, { nullIsNotFound: true }),
      ];

      // Then
      expect(results).toEqual([
        { status: "ok", data: [] },
        { status: "ok", data: [] },
      ]);
    });

    it("nullIsNotFoundのとき、dataがnullならnot-foundにする", () => {
      // Given
      // When
      const res = { data: null, error: null, status: 200 };
      const result = classifyResponse(res, { nullIsNotFound: true });

      // Then
      expect(result).toEqual({ status: "not-found" });
    });

    it("nullIsNotFoundでないとき、dataのnullはそのままokで返す", () => {
      // Given
      // When
      const res = { data: null, error: null, status: 200 };
      const result = classifyResponse(res);

      // Then
      expect(result).toEqual({ status: "ok", data: null });
    });

    it("PGRST116(406)は、not-foundにする", () => {
      // Given
      // When
      const res = { data: null, error: { code: "PGRST116" }, status: 406 };
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
        // When
        const res = { data: null, error: { message }, status: 0 };
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
        // When
        const res = { data: null, error: { code }, status };
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
        // When
        const res = {
          data: null,
          error: { code: "42501", message: "permission denied for table x" },
          status,
        };
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
    // When
    const rejected = [
      { data: null, error: { code: undefined }, status: 401 },
      { data: null, error: { code: "PGRST301" }, status: 400 },
    ];
    const others = [
      { data: null, error: { code: "42501" }, status: 403 },
      { data: null, error: { message: "Failed to fetch" }, status: 0 },
      { data: { id: "a" }, error: null, status: 200 },
    ];

    const rejectedResults = rejected.map(isAuthRejected);
    const otherResults = others.map(isAuthRejected);

    // Then
    expect(rejectedResults).toEqual([true, true]);
    expect(otherResults).toEqual([false, false, false]);
  });
});

describe("foldFailures", () => {
  const ok = { data: { id: "a" }, error: null, status: 200 };
  const commError = { data: null, error: { message: "x" }, status: 0 };
  const authError = { data: null, error: { code: "PGRST301" }, status: 401 };
  const serverError = { data: null, error: { code: "XX000" }, status: 500 };

  it("通信失敗、認証の拒否、その他のエラーの順に優先して、1つの失敗を返す", () => {
    // Given

    // When
    const comm = foldFailures([serverError, authError, commError]);
    const auth = foldFailures([serverError, authError]);
    const other = foldFailures([ok, serverError]);

    // Then
    expect(comm).toBe(commError);
    expect(auth).toBe(authError);
    expect(other).toBe(serverError);
  });

  it("失敗が無ければundefinedを返す", () => {
    // Given

    // When
    const result = foldFailures([ok, ok]);

    // Then
    expect(result).toBeUndefined();
  });
});

describe("waitLimitMs", () => {
  it("代わりがあれば短い上限、無ければ全体の上限にする", () => {
    // Given

    // When
    const withFallbackLimit = waitLimitMs(true);
    const withoutFallbackLimit = waitLimitMs(false);

    // Then
    expect(withFallbackLimit).toBe(FALLBACK_WAIT_MS);
    expect(withoutFallbackLimit).toBe(FETCH_TIMEOUT_MS);
  });
});

describe("withFallback", () => {
  it("okはそのまま返し、okでないときは代わりがあれば代わりをokで返し、無ければ元の結果を返す", () => {
    // Given
    const ok = { status: "ok", data: "取得" } as const;
    const offline = { status: "offline" } as const;

    // When
    const kept = withFallback(ok, "代わり");
    const replaced = withFallback(offline, "代わり");
    const unchanged = withFallback(offline, null);

    // Then
    expect(kept).toBe(ok);
    expect(replaced).toEqual({ status: "ok", data: "代わり" });
    expect(unchanged).toBe(offline);
  });
});

describe("commFailure", () => {
  it("オフラインならoffline、そうでなければ原因を断定しないerrorにする", () => {
    // Given

    // When
    const offline = commFailure(true);
    const error = commFailure(false);

    // Then
    expect(offline).toEqual({ status: "offline" });
    expect(error).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
  });
});

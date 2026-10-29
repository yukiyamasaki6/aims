import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  decideSyncResult,
  retryDelayMs,
  sessionFailure,
} from "./sync-failure";

const NETWORK_FAILURE = { cause: { type: "rpc", status: 0 } } as const;

describe("classifyFailure", () => {
  describe("認証の状態による失敗の場合", () => {
    it("未認証は止めて残し、認証の不明は再試行する", () => {
      // Given
      // When
      const unauthenticated = classifyFailure({ type: "unauthenticated" });
      const unknown = classifyFailure({ type: "auth-unknown" });

      // Then
      expect(unauthenticated).toBe("hold");
      expect(unknown).toBe("retry");
    });
  });

  describe("送信処理の例外の場合", () => {
    it("回復し得ないと判断できないため再試行する", () => {
      // Given
      // When
      const disposition = classifyFailure({ type: "exception" });

      // Then
      expect(disposition).toBe("retry");
    });
  });

  describe("RPCの失敗の場合", () => {
    it("認可の拒否(PT403)と契約の不一致(PT422)だけを破棄する", () => {
      // Given
      // When
      const dispositions = ["PT403", "PT422"].map((code) =>
        classifyFailure({ type: "rpc", status: 400, code }),
      );

      // Then
      expect(dispositions).toEqual(["discard", "discard"]);
    });

    it("それ以外は、HTTPステータスやSQLSTATEによらず再試行する", () => {
      // Given
      // When
      const causes = [
        ...[408, 429, 400, 401, 403, 404, 409, 499, 500, 503, 0, undefined].map(
          (status) => ({ type: "rpc", status }) as const,
        ),
        { type: "rpc", status: 404, code: "PGRST202" } as const,
        { type: "rpc", status: 400, code: "23505" } as const,
      ];
      const dispositions = causes.map(classifyFailure);

      // Then
      expect(dispositions).toEqual(causes.map(() => "retry"));
    });
  });
});

describe("sessionFailure", () => {
  it("未認証はサインインまで止める失敗に、不明(通信失敗)は通信の回復を待つ失敗にする", () => {
    // Given
    // When
    const unauthenticated = sessionFailure({ status: "unauthenticated" });
    const unknown = sessionFailure({ status: "unknown" });

    // Then
    expect(unauthenticated).toEqual({ cause: { type: "unauthenticated" } });
    expect(unknown).toEqual({ cause: { type: "auth-unknown" } });
    expect(decideSyncResult(unauthenticated, 0, 1)).toEqual({ type: "hold" });
    expect(decideSyncResult(unknown, 10, 1)).toEqual({
      type: "retry",
      delayMs: 60000,
    });
  });
});

describe("retryDelayMs", () => {
  it("試行の番号に応じて3秒から倍に伸ばし、60秒で頭打ちにする", () => {
    // Given
    // When
    const delays = [0, 1, 2, 3, 4, 5, 6, 20, 100].map(retryDelayMs);

    // Then
    expect(delays).toEqual([
      3000, 6000, 12000, 24000, 48000, 60000, 60000, 60000, 60000,
    ]);
  });
});

describe("decideSyncResult", () => {
  describe("再試行する失敗の場合", () => {
    it("試行の番号に応じてバックオフした待機時間で再試行する", () => {
      // Given
      // When
      const decisions = [0, 1, 2, 3].map((attemptIndex) =>
        decideSyncResult(NETWORK_FAILURE, attemptIndex, 1),
      );

      // Then
      expect(decisions).toEqual([
        { type: "retry", delayMs: 3000 },
        { type: "retry", delayMs: 6000 },
        { type: "retry", delayMs: 12000 },
        { type: "retry", delayMs: 24000 },
      ]);
    });

    it("上限なく再試行し、待機時間は60秒で頭打ちになる", () => {
      // Given
      // When
      const decisions = [4, 5, 20, 100].map((attemptIndex) =>
        decideSyncResult(NETWORK_FAILURE, attemptIndex, 1),
      );

      // Then
      expect(decisions).toEqual([
        { type: "retry", delayMs: 48000 },
        { type: "retry", delayMs: 60000 },
        { type: "retry", delayMs: 60000 },
        { type: "retry", delayMs: 60000 },
      ]);
    });

    it("要求の操作の数によらず、再試行は要求ごと同じ待機時間にする", () => {
      // Given
      // When
      const single = decideSyncResult(NETWORK_FAILURE, 1, 1);
      const batch = decideSyncResult(NETWORK_FAILURE, 1, 5);

      // Then
      expect(batch).toEqual(single);
    });
  });

  describe("破棄する失敗の場合", () => {
    it("1件の要求では、初回でも試行を重ねた後でも、再試行せず破棄する", () => {
      // Given
      // When
      const failure = {
        cause: { type: "rpc", status: 403, code: "PT403" },
      } as const;
      const first = decideSyncResult(failure, 0, 1);
      const afterRetries = decideSyncResult(failure, 5, 1);

      // Then
      expect(first).toEqual({ type: "discard" });
      expect(afterRetries).toEqual({ type: "discard" });
    });

    it("複数件の要求では、単独で拒否された操作だけを破棄するため、切り分ける", () => {
      // Given
      // When
      const failure = {
        cause: { type: "rpc", status: 422, code: "PT422" },
      } as const;
      const decision = decideSyncResult(failure, 0, 3);

      // Then
      expect(decision).toEqual({ type: "isolate" });
    });
  });

  describe("止めて残す失敗の場合", () => {
    it("未認証は再試行せず、要求の操作の数によらず保留にする", () => {
      // Given
      // When
      const failure = { cause: { type: "unauthenticated" } } as const;
      const single = decideSyncResult(failure, 0, 1);
      const batch = decideSyncResult(failure, 3, 4);

      // Then
      expect(single).toEqual({ type: "hold" });
      expect(batch).toEqual({ type: "hold" });
    });
  });
});

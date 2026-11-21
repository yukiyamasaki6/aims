import { describe, expect, it } from "vitest";
import { UNREACHABLE } from "./auth-failure";
import {
  beginGoogleReturn,
  beginGoogleSignIn,
  type GoogleSignInFlow,
  googleSignInReducer,
  initialGoogleSignInFlow,
} from "./google-sign-in-flow";

const running: GoogleSignInFlow = { running: true, error: null };

describe("beginGoogleSignIn", () => {
  it("オンラインで実行中でなければ、実行中にして依頼を返す", () => {
    // Given
    // When
    const result = beginGoogleSignIn(initialGoogleSignInFlow, {
      offline: false,
    });

    // Then
    expect(result.request).toBe(true);
    expect(result.state).toEqual({ running: true, error: null });
  });

  it("開始では、以前のエラーを消す", () => {
    // Given
    const failed: GoogleSignInFlow = { running: false, error: "other" };

    // When
    const result = beginGoogleSignIn(failed, { offline: false });

    // Then
    expect(result.state.error).toBeNull();
  });

  it("実行中は、開始せず、状態を変えない", () => {
    // Given
    // When
    const result = beginGoogleSignIn(running, { offline: false });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toBe(running);
  });

  it("オフラインなら、依頼を返さず、オフラインの理由を示す", () => {
    // Given
    // When
    const result = beginGoogleSignIn(initialGoogleSignInFlow, {
      offline: true,
    });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toEqual({ running: false, error: "offline" });
  });

  it("実行中かつオフラインなら、実行中の判定が先で、状態を変えない", () => {
    // Given
    // When
    const result = beginGoogleSignIn(running, { offline: true });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toBe(running);
  });
});

describe("beginGoogleReturn", () => {
  it("戻りの交換の開始は、実行中にして、以前の理由を消す", () => {
    // Given
    const failed: GoogleSignInFlow = { running: false, error: "other" };

    // When
    const result = beginGoogleReturn(failed);

    // Then
    expect(result.request).toBe(true);
    expect(result.state).toEqual({ running: true, error: null });
  });

  it("実行中は、開始せず、状態を変えない", () => {
    // Given
    // When
    const result = beginGoogleReturn(running);

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toBe(running);
  });
});

describe("googleSignInReducer", () => {
  it("failedは、実行中を解いて理由を載せる", () => {
    // Given
    // When
    const next = googleSignInReducer(running, {
      type: "failed",
      failure: UNREACHABLE,
    });

    // Then
    expect(next).toEqual({ running: false, error: UNREACHABLE.kind });
  });

  it("restoredは、実行中を解く", () => {
    // Given
    // When
    const next = googleSignInReducer(running, { type: "restored" });

    // Then
    expect(next.running).toBe(false);
  });

  it("実行中でなければ、restoredは状態を変えない", () => {
    // Given
    const idle: GoogleSignInFlow = { running: false, error: "other" };

    // When
    const next = googleSignInReducer(idle, { type: "restored" });

    // Then
    expect(next).toBe(idle);
  });
});

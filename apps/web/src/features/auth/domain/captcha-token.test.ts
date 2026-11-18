import { describe, expect, it } from "vitest";
import {
  applyCheckedToken,
  applyCheckWaitReleased,
  type CheckWaiting,
  isCaptchaCompleted,
} from "./captcha-token";

describe("isCaptchaCompleted", () => {
  it("トークンがあれば完了している", () => {
    // Given

    // When
    const result = isCaptchaCompleted("captcha-token");

    // Then
    expect(result).toBe(true);
  });

  it.each([
    ["null", null],
    ["空文字", ""],
  ])("トークンが%sなら完了していない", (_name, token) => {
    // Given

    // When
    const result = isCaptchaCompleted(token);

    // Then
    expect(result).toBe(false);
  });
});

type Flow = CheckWaiting & { readonly running: boolean };

const waitingFlow: Flow = {
  captchaToken: null,
  awaitingCheck: true,
  fieldErrors: {},
  running: true,
};
const idle = { running: false };

describe("applyCheckWaitReleased", () => {
  it("待ちの間は、待ちと実行中を解き、チェックのエラーを示し、トークンは触らない", () => {
    // Given
    const flow: Flow = { ...waitingFlow, captchaToken: "token" };

    // When
    const result = applyCheckWaitReleased(flow, idle);

    // Then
    expect(result).toMatchObject({
      awaitingCheck: false,
      running: false,
      captchaToken: "token",
      fieldErrors: { captcha: "incomplete" },
    });
  });

  it("待ちでなければ、何も変えない", () => {
    // Given
    const flow: Flow = { ...waitingFlow, awaitingCheck: false };

    // When
    const result = applyCheckWaitReleased(flow, idle);

    // Then
    expect(result).toBe(flow);
  });
});

describe("applyCheckedToken", () => {
  it("トークンが届くと、示していたチェックのエラーを解く", () => {
    // Given
    const flow: Flow = {
      ...waitingFlow,
      awaitingCheck: false,
      fieldErrors: { captcha: "incomplete" },
    };

    // When
    const result = applyCheckedToken(flow, "token");

    // Then
    expect(result.captchaToken).toBe("token");
    expect(result.fieldErrors.captcha).toBeUndefined();
  });

  it("失効(null)では、トークンを外すだけで、待ちもチェックのエラーも変えない", () => {
    // Given
    const flow: Flow = {
      ...waitingFlow,
      captchaToken: "token",
      fieldErrors: { captcha: "incomplete" },
    };

    // When
    const result = applyCheckedToken(flow, null);

    // Then
    expect(result).toEqual({ ...flow, captchaToken: null });
  });
});

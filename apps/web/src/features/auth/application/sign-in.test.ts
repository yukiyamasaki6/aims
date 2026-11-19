import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import {
  type EmailOtpEvent,
  type EmailOtpFlow,
  emailOtpReducer,
  initialEmailOtpFlow,
} from "../domain/email-otp-flow";
import type { CallResult } from "./call-result";
import type { CodeVerification } from "./email-otp";
import { screenHarness } from "./screen-view-test-helpers";
import { createSignIn } from "./sign-in";

describe("ログインの入口", () => {
  it.each([
    [null, "/rounds"],
    ["/rounds/history", "/rounds/history"],
    ["https://external.example", "/rounds"],
    ["//external.example", "/rounds"],
  ])("遷移元%sからOTP確認後に%sへ移る", async (from, destination) => {
    // Given
    const authenticator = {
      sendCode: vi.fn(async (): Promise<CallResult> => ({ kind: "accepted" })),
      verifyCode: vi.fn(
        async (): Promise<CodeVerification> => ({ kind: "verified" }),
      ),
    };
    const pageReplace = { replace: vi.fn() };
    const procedure = createSignIn({
      authenticator,
      pageReplace,
      clock: createManualClock(),
      connectivity: createFakeConnectivity(),
    });
    const harness = screenHarness<EmailOtpFlow, EmailOtpEvent>(emailOtpReducer);
    const view = harness.viewOf({
      ...initialEmailOtpFlow,
      captchaToken: "check",
    });
    await procedure.sendCode({ email: "archer@example.test", from }, view);
    // When
    await procedure.verifyCode(
      { email: "archer@example.test", code: "123456" },
      view,
    );
    // Then
    expect(authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
      email: "archer@example.test",
      captchaToken: "check",
      shouldCreateUser: true,
    });
    expect(pageReplace.replace).toHaveBeenCalledExactlyOnceWith(destination);
  });
});

import { describe, expect, it, vi } from "vitest";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  beginSignIn,
  initialSignInFlow,
  signInReducer,
} from "../domain/sign-in-flow";
import type { CallResult } from "./call-result";
import { screenHarness } from "./screen-view-test-helpers";
import { createSignIn } from "./sign-in";

const input = { email: "user@example.com", password: "password1" };
const verified = signInReducer(initialSignInFlow, {
  type: "captchaChecked",
  token: "first-token",
});

const accepted: CallResult = { kind: "accepted" };

function setup(returnTo: string | null = null) {
  const authenticator = {
    signIn: vi.fn(async (): Promise<CallResult> => accepted),
  };
  const navigation = { returnTo: vi.fn(() => returnTo), go: vi.fn() };
  const signIn = createSignIn({ authenticator, navigation });
  const { events, resetCheck, viewOf, screen } = screenHarness(signInReducer);
  return {
    signIn,
    authenticator,
    navigation,
    actions: events,
    resetCheck,
    viewOf,
    state: screen,
  };
}

const refused = (failure: AuthFailure): CallResult => ({
  kind: "refused",
  failure,
});

const failure401: AuthFailure = { kind: "invalid_credentials" };

describe("サインインの手続き", () => {
  it.each([
    [null, "/rounds"],
    ["/rounds/new?a=1", "/rounds/new?a=1"],
    ["https://evil.com/rounds", "/rounds"],
  ])(
    "成功時に許可された遷移先 %s へ進み、失敗とチェックのやり直しを起こさない",
    async (returnTo, expected) => {
      // Given
      const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
        setup(returnTo);

      // When
      await signIn.submit(input, viewOf(verified));

      // Then
      expect(authenticator.signIn).toHaveBeenCalledWith({
        ...input,
        captchaToken: "first-token",
      });
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith(expected);
      expect(actions).toEqual([]);
      expect(resetCheck).not.toHaveBeenCalled();
    },
  );

  it("渡された状態が送信中なら、何も送らず、照合も遷移もしない", async () => {
    // Given
    const { signIn, authenticator, navigation, actions, viewOf } = setup();
    const started = beginSignIn(verified, input).state;

    // When
    await signIn.submit(input, viewOf(started));

    // Then
    expect(actions).toEqual([]);
    expect(authenticator.signIn).not.toHaveBeenCalled();
    expect(navigation.go).not.toHaveBeenCalled();
  });

  it("同じタスクで続けて2回submitしても、2回目は送信中を見て拒否され、照合は1回になる", async () => {
    // Given
    const { signIn, authenticator, navigation, actions, viewOf } = setup();
    const view = viewOf(verified);

    // When
    const first = signIn.submit(input, view);
    const second = signIn.submit(input, view);
    await Promise.all([first, second]);

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
    expect(actions).toEqual([]);
    expect(navigation.go).toHaveBeenCalledOnce();
  });

  it.each([
    ["bad-email", "password1", "first-token"],
    ["user@example.com", "", "first-token"],
    ["user@example.com", "password1", null],
  ])(
    "不備がある入力では認証を呼ばず、不備を状態に示すだけで、出来事を送らない",
    async (email, password, token) => {
      // Given
      const { signIn, authenticator, actions, resetCheck, viewOf } = setup();
      const view = viewOf(
        signInReducer(initialSignInFlow, { type: "captchaChecked", token }),
      );

      // When
      await signIn.submit({ email, password }, view);

      // Then
      expect(authenticator.signIn).not.toHaveBeenCalled();
      expect(Object.keys(view.state.fieldErrors)).toHaveLength(1);
      expect(view.state.submitting).toBe(false);
      expect(actions).toEqual([]);
      expect(resetCheck).not.toHaveBeenCalled();
    },
  );

  it.each([
    [refused(failure401), failure401],
    [UNREACHABLE, UNREACHABLE],
  ])(
    "失敗時はfailedを送り、チェックを1回やり直させ、遷移しない",
    async (result, failure) => {
      // Given
      const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
        setup();
      authenticator.signIn.mockResolvedValue(result);

      // When
      await signIn.submit(input, viewOf(verified));

      // Then
      expect(actions).toEqual([{ type: "failed", failure }]);
      expect(resetCheck).toHaveBeenCalledOnce();
      expect(navigation.go).not.toHaveBeenCalled();
    },
  );

  it("失敗後の新しいトークンで再送信すると元の遷移先へ進む", async () => {
    // Given
    const { signIn, authenticator, navigation, viewOf } = setup("/rounds/new");
    authenticator.signIn.mockResolvedValueOnce(refused(failure401));
    const view = viewOf(verified);
    await signIn.submit(input, view);

    // When
    view.dispatch({ type: "captchaChecked", token: "second-token" });
    await signIn.submit(input, view);

    // Then
    expect(authenticator.signIn).toHaveBeenLastCalledWith({
      ...input,
      captchaToken: "second-token",
    });
    expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/rounds/new");
  });

  it("照合の後に画面が離れていれば、成功でも遷移しない", async () => {
    // Given
    const { signIn, authenticator, navigation, viewOf, state } = setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const pending = signIn.submit(input, viewOf(verified));

    // When
    state.mounted = false;
    deferred.resolve(accepted);
    await pending;

    // Then
    expect(navigation.go).not.toHaveBeenCalled();
  });

  it("照合の後に画面が離れていれば、失敗でもfailedを送らずチェックをやり直させない", async () => {
    // Given
    const { signIn, authenticator, actions, resetCheck, viewOf, state } =
      setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const pending = signIn.submit(input, viewOf(verified));

    // When
    state.mounted = false;
    deferred.resolve(UNREACHABLE);
    await pending;

    // Then
    expect(actions).toEqual([]);
    expect(resetCheck).not.toHaveBeenCalled();
  });

  it.each([
    ["遷移", "go"],
    ["遷移元の読み出し", "returnTo"],
  ] as const)(
    "%sが投げると、通信断の失敗にして送信中を解除できる状態にする",
    async (_name, method) => {
      // Given
      const { signIn, navigation, actions, resetCheck, viewOf } = setup();
      navigation[method].mockImplementation(() => {
        throw new Error("navigation failed");
      });

      // When
      await signIn.submit(input, viewOf(verified));

      // Then
      expect(actions).toEqual([{ type: "failed", failure: UNREACHABLE }]);
      expect(resetCheck).toHaveBeenCalledOnce();
    },
  );
});

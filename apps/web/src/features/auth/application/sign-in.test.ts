import { describe, expect, it, vi } from "vitest";
import type { AuthFailure } from "../domain/auth-failure";
import {
  initialAttempt,
  type SignInAction,
  type SignInAttempt,
  signInReducer,
} from "../domain/sign-in-attempt";
import type { ScreenView } from "./screen-view";
import { createSignIn } from "./sign-in";

const input = { email: "user@example.com", password: "password1" };
const verified = signInReducer(initialAttempt, {
  type: "verified",
  token: "first-token",
});

function setup(returnTo: string | null = null) {
  const authenticator = {
    signIn: vi.fn(async (): Promise<AuthFailure | null> => null),
  };
  const navigation = { returnTo: vi.fn(() => returnTo), go: vi.fn() };
  const signIn = createSignIn({ authenticator, navigation });
  const actions: SignInAction[] = [];
  const resetCheck = vi.fn();
  // 画面の約束の偽。出来事を実物のreducerで適用し、stateは送った直後の値を返す。表示中かどうかは、テストが切り替える。
  const screen = { mounted: true };
  const viewOf = (
    initial: SignInAttempt,
  ): ScreenView<SignInAttempt, SignInAction> => {
    let current = initial;
    return {
      get state() {
        return current;
      },
      dispatch: (action) => {
        actions.push(action);
        current = signInReducer(current, action);
      },
      resetCheck,
      isMounted: () => screen.mounted,
    };
  };
  return {
    signIn,
    authenticator,
    navigation,
    actions,
    resetCheck,
    viewOf,
    state: screen,
  };
}

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
      expect(actions.map((a) => a.type)).toEqual(["submitted"]);
      expect(resetCheck).not.toHaveBeenCalled();
    },
  );

  it("渡された状態が送信中なら、何も送らず、照合も遷移もしない", async () => {
    // Given
    const { signIn, authenticator, navigation, actions, viewOf } = setup();
    const started = signInReducer(verified, { type: "submitted" });

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
    expect(actions.map((a) => a.type)).toEqual(["submitted"]);
    expect(navigation.go).toHaveBeenCalledOnce();
  });

  it.each([
    ["bad-email", "password1", "first-token"],
    ["user@example.com", "", "first-token"],
    ["user@example.com", "password1", null],
  ])(
    "不備がある入力では認証を呼ばず、invalidだけを送る",
    async (email, password, token) => {
      // Given
      const { signIn, authenticator, actions, resetCheck, viewOf } = setup();
      const attempt = signInReducer(initialAttempt, {
        type: "verified",
        token,
      });

      // When
      await signIn.submit({ email, password }, viewOf(attempt));

      // Then
      expect(authenticator.signIn).not.toHaveBeenCalled();
      expect(actions.map((a) => a.type)).toEqual(["invalid"]);
      expect(resetCheck).not.toHaveBeenCalled();
    },
  );

  it.each([[failure401], [{ kind: "unreachable" } as const]])(
    "失敗時はsubmittedの次にfailedを送り、チェックを1回やり直させ、遷移しない",
    async (failure) => {
      // Given
      const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
        setup();
      authenticator.signIn.mockResolvedValue(failure);

      // When
      await signIn.submit(input, viewOf(verified));

      // Then
      expect(actions).toEqual([
        { type: "submitted" },
        { type: "failed", failure },
      ]);
      expect(resetCheck).toHaveBeenCalledOnce();
      expect(navigation.go).not.toHaveBeenCalled();
    },
  );

  it("失敗後の新しいトークンで再送信すると元の遷移先へ進む", async () => {
    // Given
    const { signIn, authenticator, navigation, viewOf } = setup("/rounds/new");
    authenticator.signIn.mockResolvedValueOnce(failure401);
    const view = viewOf(verified);
    await signIn.submit(input, view);

    // When
    view.dispatch({ type: "verified", token: "second-token" });
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
    const deferred = Promise.withResolvers<AuthFailure | null>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const pending = signIn.submit(input, viewOf(verified));

    // When
    state.mounted = false;
    deferred.resolve(null);
    await pending;

    // Then
    expect(navigation.go).not.toHaveBeenCalled();
  });

  it("照合の後に画面が離れていれば、失敗でもfailedを送らずチェックをやり直させない", async () => {
    // Given
    const { signIn, authenticator, actions, resetCheck, viewOf, state } =
      setup();
    const deferred = Promise.withResolvers<AuthFailure | null>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const pending = signIn.submit(input, viewOf(verified));

    // When
    state.mounted = false;
    deferred.resolve({ kind: "unreachable" });
    await pending;

    // Then
    expect(actions.map((a) => a.type)).toEqual(["submitted"]);
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
      expect(actions).toEqual([
        { type: "submitted" },
        { type: "failed", failure: { kind: "unreachable" } },
      ]);
      expect(resetCheck).toHaveBeenCalledOnce();
    },
  );
});

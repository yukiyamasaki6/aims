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
    "成功時にsignedInだけを送って許可された遷移先 %s へ進み、失敗とチェックのやり直しを起こさない",
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
      expect(actions).toEqual([{ type: "signedIn" }]);
      expect(resetCheck).not.toHaveBeenCalled();
    },
  );

  it("前の失敗の後の成功では、遷移元の読み出しと遷移の前にsignedInを送り、遷移の中ではエラーが消えて送信中のままである", async () => {
    // Given
    const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
      setup("/rounds/new");
    authenticator.signIn.mockResolvedValueOnce(UNREACHABLE);
    const view = viewOf(verified);
    await signIn.submit(input, view);
    const seen: {
      events: string[];
      error: string | null;
      submitting: boolean;
    }[] = [];
    const observe = () => {
      seen.push({
        events: actions.map((event) => event.type),
        error: view.state.error,
        submitting: view.state.submitting,
      });
    };
    navigation.returnTo.mockImplementation(() => {
      observe();
      return "/rounds/new";
    });
    navigation.go.mockImplementation(observe);

    // When
    await signIn.submit(input, view);

    // Then
    expect(seen).toEqual([
      { events: ["failed", "signedIn"], error: null, submitting: true },
      { events: ["failed", "signedIn"], error: null, submitting: true },
    ]);
    expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/rounds/new");
    expect(resetCheck).not.toHaveBeenCalled();
  });

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
    expect(actions).toEqual([{ type: "signedIn" }]);
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

  it("通常の拒否では、refusedを送ってトークンを消費し、チェックを1回やり直させ、遷移しない", async () => {
    // Given
    const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
      setup();
    authenticator.signIn.mockResolvedValue(refused(failure401));
    const view = viewOf(verified);

    // When
    await signIn.submit(input, view);

    // Then
    expect(actions).toEqual([{ type: "refused", failure: failure401 }]);
    expect(resetCheck).toHaveBeenCalledOnce();
    expect(view.state.captchaToken).toBeNull();
    expect(view.state.error).toBe(
      "メールアドレスまたはパスワードが間違っています。",
    );
    expect(navigation.go).not.toHaveBeenCalled();
  });

  it.each([
    ["呼び出しが投げた", UNREACHABLE],
    ["通信の断を値で返した", refused(UNREACHABLE)],
  ])(
    "照合が届かなかった(%s)ときは、failedを送ってトークンを保持し、チェックをやり直させず、遷移しない",
    async (_name, result) => {
      // Given
      const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
        setup();
      authenticator.signIn.mockResolvedValue(result);
      const view = viewOf(verified);

      // When
      await signIn.submit(input, view);

      // Then
      expect(actions).toEqual([{ type: "failed", failure: UNREACHABLE }]);
      expect(resetCheck).not.toHaveBeenCalled();
      expect(view.state.captchaToken).toBe("first-token");
      expect(view.state.error).toBe(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      expect(view.state.submitting).toBe(false);
      expect(navigation.go).not.toHaveBeenCalled();
    },
  );

  it("照合が届かなかった後は、チェックをやり直さずに同じトークンで再送信でき、元の遷移先へ進む", async () => {
    // Given
    const { signIn, authenticator, navigation, viewOf } = setup("/rounds/new");
    authenticator.signIn.mockResolvedValueOnce(UNREACHABLE);
    const view = viewOf(verified);
    await signIn.submit(input, view);

    // When
    await signIn.submit(input, view);

    // Then
    expect(authenticator.signIn).toHaveBeenCalledTimes(2);
    expect(authenticator.signIn).toHaveBeenLastCalledWith({
      ...input,
      captchaToken: "first-token",
    });
    expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/rounds/new");
  });

  it("通常の拒否の後は、新しいトークンが無いまま再送信しても照合しない", async () => {
    // Given
    const { signIn, authenticator, viewOf } = setup();
    authenticator.signIn.mockResolvedValueOnce(refused(failure401));
    const view = viewOf(verified);
    await signIn.submit(input, view);

    // When
    await signIn.submit(input, view);

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
    expect(view.state.fieldErrors).toEqual({
      captcha: "セキュリティチェックが完了していません。",
    });
  });

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

  it("照合の後に画面が離れていれば、成功でもsignedInを送らず、遷移しない", async () => {
    // Given
    const { signIn, authenticator, navigation, actions, viewOf, state } =
      setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const pending = signIn.submit(input, viewOf(verified));

    // When
    state.mounted = false;
    deferred.resolve(accepted);
    await pending;

    // Then
    expect(navigation.go).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it.each([
    ["届かない失敗", UNREACHABLE],
    ["通常の拒否", refused(failure401)],
  ])(
    "照合の後に画面が離れていれば、%sでも出来事を送らずチェックをやり直させない",
    async (_name, result) => {
      // Given
      const {
        signIn,
        authenticator,
        navigation,
        actions,
        resetCheck,
        viewOf,
        state,
      } = setup();
      const deferred = Promise.withResolvers<CallResult>();
      authenticator.signIn.mockReturnValue(deferred.promise);
      const pending = signIn.submit(input, viewOf(verified));

      // When
      state.mounted = false;
      deferred.resolve(result);
      await pending;

      // Then
      expect(actions).toEqual([]);
      expect(resetCheck).not.toHaveBeenCalled();
      expect(navigation.go).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["遷移", "go"],
    ["遷移元の読み出し", "returnTo"],
  ] as const)(
    "成功の後に%sが投げると、signedInの後に、使ったトークンを消費して通信断の失敗にし、チェックをやり直させて送信中を解除する",
    async (_name, method) => {
      // Given
      const { signIn, navigation, actions, resetCheck, viewOf } = setup();
      navigation[method].mockImplementation(() => {
        throw new Error("navigation failed");
      });
      const view = viewOf(verified);

      // When
      await signIn.submit(input, view);

      // Then
      expect(actions).toEqual([
        { type: "signedIn" },
        { type: "refused", failure: UNREACHABLE },
      ]);
      expect(resetCheck).toHaveBeenCalledOnce();
      expect(view.state.error).toBe(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      expect(view.state.captchaToken).toBeNull();
      expect(view.state.submitting).toBe(false);
    },
  );
});

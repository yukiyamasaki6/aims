import { describe, expect, it, vi } from "vitest";
import { createFakePageNavigation } from "@/lib/page-navigation/fake-page-navigation-test-helpers";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  beginSignIn,
  initialSignInFlow,
  signInReducer,
} from "../domain/sign-in-flow";
import type { CallResult } from "./call-result";
import { screenHarness } from "./screen-view-test-helpers";
import { createSignIn } from "./sign-in";

const input = {
  email: "user@example.com",
  password: "password1",
  from: null,
};
const credentialsOf = { email: input.email, password: input.password };
const verified = signInReducer(initialSignInFlow, {
  type: "captchaChecked",
  token: "first-token",
});

const accepted: CallResult = { kind: "accepted" };

function setup(protectedPath = "/rounds") {
  const authenticator = {
    signIn: vi.fn(async (): Promise<CallResult> => accepted),
  };
  const fake = createFakePageNavigation();
  const navigation = { go: fake.go };
  const signIn = createSignIn({
    authenticator,
    pageNavigation: fake.pageNavigation,
    protectedPath,
  });
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
  kind: "failed",
  failure,
});

const failure401: AuthFailure = { kind: "invalid_credentials" };

describe("サインインの手続き", () => {
  it.each([
    [null, "/rounds"],
    ["/rounds/new?a=1", "/rounds/new?a=1"],
    ["https://evil.com/rounds", "/rounds"],
    ["//evil.com", "/rounds"],
    ["/signin", "/rounds"],
    ["/rounds/../signin", "/rounds"],
  ])(
    "成功時にsignedInだけを送って許可された遷移先 %s へ進み、失敗とチェックのやり直しを起こさない",
    async (returnTo, expected) => {
      // Given
      const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
        setup();

      // When
      await signIn.submit({ ...input, from: returnTo }, viewOf(verified));

      // Then
      expect(authenticator.signIn).toHaveBeenCalledWith({
        ...credentialsOf,
        captchaToken: "first-token",
      });
      expect(navigation.go).toHaveBeenCalledExactlyOnceWith(expected);
      expect(actions).toEqual([{ type: "signedIn" }]);
      expect(resetCheck).not.toHaveBeenCalled();
    },
  );

  it("保護の範囲の根が異なる場合、既定の行き先は根になり、根の下の遷移元だけを許す", async () => {
    // Given
    const withoutReturnTo = setup("/elsewhere");
    const insideRoot = setup("/elsewhere");
    const outsideRoot = setup("/elsewhere");

    // When
    await withoutReturnTo.signIn.submit(
      input,
      withoutReturnTo.viewOf(verified),
    );
    await insideRoot.signIn.submit(
      { ...input, from: "/elsewhere/x?a=1" },
      insideRoot.viewOf(verified),
    );
    await outsideRoot.signIn.submit(
      { ...input, from: "/rounds/new" },
      outsideRoot.viewOf(verified),
    );

    // Then
    expect(withoutReturnTo.navigation.go).toHaveBeenCalledExactlyOnceWith(
      "/elsewhere",
    );
    expect(insideRoot.navigation.go).toHaveBeenCalledExactlyOnceWith(
      "/elsewhere/x?a=1",
    );
    expect(outsideRoot.navigation.go).toHaveBeenCalledExactlyOnceWith(
      "/elsewhere",
    );
  });

  it("前の失敗の後の成功では、遷移の前にsignedInを送り、遷移の中ではエラーが消えて送信中のままである", async () => {
    // Given
    const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
      setup();
    authenticator.signIn.mockResolvedValueOnce(refused(UNREACHABLE));
    const view = viewOf(verified);
    await signIn.submit(input, view);
    view.dispatch({ type: "captchaChecked", token: "second-token" });
    const seen: {
      events: string[];
      error: string | null;
      submitting: boolean;
    }[] = [];
    const observe = () => {
      seen.push({
        events: actions.map((event) => event.type),
        error: view.observedState.error,
        submitting: view.observedState.submitting,
      });
    };
    navigation.go.mockImplementation(observe);

    // When
    await signIn.submit({ ...input, from: "/rounds/new" }, view);

    // Then
    expect(seen).toEqual([
      {
        events: ["failed", "captchaChecked", "signedIn"],
        error: null,
        submitting: true,
      },
    ]);
    expect(navigation.go).toHaveBeenCalledExactlyOnceWith("/rounds/new");
    // 最初の失敗の分だけで、成功ではやり直さない。
    expect(resetCheck).toHaveBeenCalledOnce();
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
      await signIn.submit({ email, password, from: null }, view);

      // Then
      expect(authenticator.signIn).not.toHaveBeenCalled();
      expect(Object.keys(view.observedState.fieldErrors)).toHaveLength(1);
      expect(view.observedState.submitting).toBe(false);
      expect(actions).toEqual([]);
      expect(resetCheck).not.toHaveBeenCalled();
    },
  );

  it("拒否では、failedを送ってトークンを消費し、チェックを1回やり直させ、遷移しない", async () => {
    // Given
    const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
      setup();
    authenticator.signIn.mockResolvedValue(refused(failure401));
    const view = viewOf(verified);

    // When
    await signIn.submit(input, view);

    // Then
    expect(actions).toEqual([{ type: "failed", failure: failure401 }]);
    expect(resetCheck).toHaveBeenCalledOnce();
    expect(view.observedState.captchaToken).toBeNull();
    expect(view.observedState.error).toBe("invalid_credentials");
    expect(navigation.go).not.toHaveBeenCalled();
  });

  it("通信の断を値で返された失敗も、拒否と同じく、failedを送ってトークンを消費し、チェックを1回やり直させ、遷移しない", async () => {
    // Given
    const { signIn, authenticator, navigation, actions, resetCheck, viewOf } =
      setup();
    authenticator.signIn.mockResolvedValue(refused(UNREACHABLE));
    const view = viewOf(verified);

    // When
    await signIn.submit(input, view);

    // Then
    expect(actions).toEqual([{ type: "failed", failure: UNREACHABLE }]);
    expect(resetCheck).toHaveBeenCalledOnce();
    expect(view.observedState.captchaToken).toBeNull();
    expect(view.observedState.error).toBe("unreachable");
    expect(view.observedState.submitting).toBe(false);
    expect(navigation.go).not.toHaveBeenCalled();
  });

  it("失敗の後は、新しいトークンが無いまま再送信しても照合しない", async () => {
    // Given
    const { signIn, authenticator, viewOf } = setup();
    authenticator.signIn.mockResolvedValueOnce(refused(failure401));
    const view = viewOf(verified);
    await signIn.submit(input, view);

    // When
    await signIn.submit(input, view);

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
    expect(view.observedState.fieldErrors).toEqual({
      captcha: "incomplete",
    });
  });

  it("失敗後の新しいトークンで再送信すると元の遷移先へ進む", async () => {
    // Given
    const { signIn, authenticator, navigation, viewOf } = setup();
    const retry = { ...input, from: "/rounds/new" };
    authenticator.signIn.mockResolvedValueOnce(refused(failure401));
    const view = viewOf(verified);
    await signIn.submit(retry, view);

    // When
    view.dispatch({ type: "captchaChecked", token: "second-token" });
    await signIn.submit(retry, view);

    // Then
    expect(authenticator.signIn).toHaveBeenLastCalledWith({
      ...credentialsOf,
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
    ["通信の失敗", refused(UNREACHABLE)],
    ["拒否", refused(failure401)],
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
});

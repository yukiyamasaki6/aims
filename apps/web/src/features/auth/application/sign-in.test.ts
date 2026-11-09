import { describe, expect, it, vi } from "vitest";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
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

function setup(offline = false) {
  const authenticator = {
    signIn: vi.fn(async (): Promise<CallResult> => accepted),
  };
  const pageReplace = { replace: vi.fn<(path: string) => void>() };
  const connectivity = createFakeConnectivity(offline);
  const signIn = createSignIn({
    authenticator,
    pageReplace,
    connectivity,
  });
  const { events, resetCheck, viewOf, screen } = screenHarness(signInReducer);
  return {
    signIn,
    authenticator,
    connectivity,
    pageReplace,
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
    "成功時に何も送らずに許可された遷移先 %s へ進み、失敗とチェックのやり直しを起こさない",
    async (returnTo, expected) => {
      // Given
      const {
        signIn,
        authenticator,
        pageReplace,
        actions,
        resetCheck,
        viewOf,
      } = setup();

      // When
      await signIn.submit({ ...input, from: returnTo }, viewOf(verified));

      // Then
      expect(authenticator.signIn).toHaveBeenCalledWith({
        ...credentialsOf,
        captchaToken: "first-token",
      });
      expect(pageReplace.replace).toHaveBeenCalledExactlyOnceWith(expected);
      expect(actions).toEqual([]);
      expect(resetCheck).not.toHaveBeenCalled();
    },
  );

  it("前の失敗の後の成功では、遷移の時点でエラーは消えており、送信中のままである", async () => {
    // Given
    const { signIn, authenticator, pageReplace, actions, resetCheck, viewOf } =
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
    pageReplace.replace.mockImplementation(observe);

    // When
    await signIn.submit({ ...input, from: "/rounds/new" }, view);

    // Then
    expect(seen).toEqual([
      {
        events: ["failed", "captchaChecked"],
        error: null,
        submitting: true,
      },
    ]);
    expect(pageReplace.replace).toHaveBeenCalledExactlyOnceWith("/rounds/new");
    // 最初の失敗の分だけで、成功ではやり直さない。
    expect(resetCheck).toHaveBeenCalledOnce();
  });

  it("オフラインなら、認証サービスを呼ばず、チェックのやり直しもせず、offlineを示す", async () => {
    // Given
    const { signIn, authenticator, pageReplace, resetCheck, viewOf } =
      setup(true);
    const view = viewOf(verified);

    // When
    await signIn.submit(input, view);

    // Then
    expect(authenticator.signIn).not.toHaveBeenCalled();
    expect(resetCheck).not.toHaveBeenCalled();
    expect(pageReplace.replace).not.toHaveBeenCalled();
    expect(view.observedState.error).toBe("offline");
    expect(view.observedState.captchaToken).toBe("first-token");
    expect(view.observedState.submitting).toBe(false);
  });

  it("オフラインでチェックが未完了でも、チェック未完了でなくoffline。オンラインに戻すと通常の送信になる", async () => {
    // Given
    const { signIn, authenticator, connectivity, viewOf } = setup(true);
    const view = viewOf(initialSignInFlow);

    // When
    await signIn.submit(input, view);
    const whileOffline = view.observedState;
    connectivity.goOnline();
    await signIn.submit(input, viewOf(verified));

    // Then
    expect(whileOffline.error).toBe("offline");
    expect(whileOffline.fieldErrors).toEqual({});
    expect(authenticator.signIn).toHaveBeenCalledOnce();
  });

  it("オフラインの状態を購読しない", async () => {
    // Given
    const { signIn, connectivity, viewOf } = setup(true);

    // When
    await signIn.submit(input, viewOf(verified));

    // Then
    expect(connectivity.subscribers()).toEqual({ online: 0 });
  });

  it("渡された状態が送信中なら、何も送らず、照合も遷移もしない", async () => {
    // Given
    const { signIn, authenticator, pageReplace, actions, viewOf } = setup();
    const started = beginSignIn(verified, {
      ...credentialsOf,
      offline: false,
    }).state;

    // When
    await signIn.submit(input, viewOf(started));

    // Then
    expect(actions).toEqual([]);
    expect(authenticator.signIn).not.toHaveBeenCalled();
    expect(pageReplace.replace).not.toHaveBeenCalled();
  });

  it("同じタスクで続けて2回submitしても、2回目は送信中を見て拒否され、照合は1回になる", async () => {
    // Given
    const { signIn, authenticator, pageReplace, actions, viewOf } = setup();
    const view = viewOf(verified);

    // When
    const first = signIn.submit(input, view);
    const second = signIn.submit(input, view);
    await Promise.all([first, second]);

    // Then
    expect(authenticator.signIn).toHaveBeenCalledOnce();
    expect(actions).toEqual([]);
    expect(pageReplace.replace).toHaveBeenCalledOnce();
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
    const { signIn, authenticator, pageReplace, actions, resetCheck, viewOf } =
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
    expect(pageReplace.replace).not.toHaveBeenCalled();
  });

  it("通信の断を値で返された失敗も、拒否と同じく、failedを送ってトークンを消費し、チェックを1回やり直させ、遷移しない", async () => {
    // Given
    const { signIn, authenticator, pageReplace, actions, resetCheck, viewOf } =
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
    expect(pageReplace.replace).not.toHaveBeenCalled();
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
    const { signIn, authenticator, pageReplace, viewOf } = setup();
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
    expect(pageReplace.replace).toHaveBeenCalledExactlyOnceWith("/rounds/new");
  });

  it("照合の後に画面が離れていれば、成功でも遷移せず、何も送らない", async () => {
    // Given
    const { signIn, authenticator, pageReplace, actions, viewOf, state } =
      setup();
    const deferred = Promise.withResolvers<CallResult>();
    authenticator.signIn.mockReturnValue(deferred.promise);
    const pending = signIn.submit(input, viewOf(verified));

    // When
    state.mounted = false;
    deferred.resolve(accepted);
    await pending;

    // Then
    expect(pageReplace.replace).not.toHaveBeenCalled();
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
        pageReplace,
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
      expect(pageReplace.replace).not.toHaveBeenCalled();
    },
  );
});

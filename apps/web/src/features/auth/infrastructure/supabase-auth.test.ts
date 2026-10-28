import {
  AuthApiError,
  type AuthError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthChange } from "../domain/auth-change";
import { createSupabaseAuth } from "./supabase-auth";

const expired = new AuthApiError("Token has expired", 403, "otp_expired");
const rateLimited = new AuthApiError(
  "rate limit",
  429,
  "over_email_send_rate_limit",
);
const weakPassword = new AuthApiError("weak", 422, "weak_password");
const connectionLost = new AuthRetryableFetchError("Failed to fetch", 0);

type Listener = (
  event: string,
  session: { user: { id: string } } | null,
) => void;

// 認証サービスの各呼び出しを差し替えた偽の接続。
function setup() {
  const listeners: Listener[] = [];
  const unsubscribe = vi.fn();
  const auth = {
    signInWithPassword: vi.fn(),
    signInWithOtp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.push(listener);
      // 解除すると、実際にこのリスナーへ以降の出来事が届かなくなる。
      const stop = () => {
        unsubscribe();
        listeners.splice(listeners.indexOf(listener), 1);
      };
      return { data: { subscription: { unsubscribe: stop } } };
    }),
  };
  const getClient = vi.fn(
    () => ({ auth }) as unknown as Pick<SupabaseClient, "auth">,
  );
  return {
    service: createSupabaseAuth(getClient),
    auth,
    getClient,
    unsubscribe,
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of listeners) listener(event, session);
    },
  };
}

// 接続を得られない(環境変数の欠落)認証サービス。
function unavailableService() {
  return createSupabaseAuth(() => {
    throw new Error("Missing Supabase environment variables in client.");
  });
}

const credentials = {
  email: "user@example.com",
  password: "password1",
  captchaToken: "captcha-token",
};

describe("頼みごとの結果", () => {
  it("応答があって成功なら、受け付けられた", async () => {
    // Given
    const { service, auth } = setup();
    auth.updateUser.mockResolvedValue({ error: null });

    // When
    const result = await service.setPassword("password1");

    // Then
    expect(result).toEqual({ kind: "accepted" });
  });

  it("エラーが値で返れば、拒否された(通信の断を値で返す場合は、届かなかった種類の拒否)", async () => {
    // Given
    const { service, auth } = setup();
    auth.updateUser.mockResolvedValue({ error: weakPassword });
    auth.verifyOtp.mockResolvedValue({ error: connectionLost });

    // When
    const weak = await service.setPassword("password1");
    const lost = await service.verifyCode({
      purpose: "sign-up",
      email: "user@example.com",
      code: "123456",
    });

    // Then
    expect(weak).toEqual({
      kind: "refused",
      failure: { kind: "weak_password" },
    });
    expect(lost).toEqual({
      kind: "refused",
      failure: { kind: "unreachable" },
    });
  });

  it("呼び出しが投げたときと、接続を得られないときは、届かなかった", async () => {
    // Given
    const { service, auth } = setup();
    auth.updateUser.mockRejectedValue(new Error("network down"));

    // When
    const thrown = await service.setPassword("password1");
    const unavailable = await unavailableService().signIn(credentials);

    // Then
    expect(thrown).toEqual({ kind: "unreachable" });
    expect(unavailable).toEqual({ kind: "unreachable" });
  });

  it("接続を得られないときの読み取りは、不明にする", async () => {
    // Given
    const service = unavailableService();

    // When
    const reading = await service.readSession();

    // Then
    expect(reading).toEqual({ status: "unknown" });
  });

  it("接続は、作った時点では取得せず、頼みごとのたびに取得する", async () => {
    // Given
    const { service, auth, getClient } = setup();
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    expect(getClient).not.toHaveBeenCalled();

    // When
    await service.verifyCode({
      purpose: "sign-up",
      email: "a@example.com",
      code: "123456",
    });
    await service.setPassword("password1");
    await service.signOutHere();

    // Then
    expect(getClient).toHaveBeenCalledTimes(3);
  });
});

describe("認証サービスのエラーの失敗の種類への変換", () => {
  const refusedWith = async (error: unknown) => {
    const { service, auth } = setup();
    auth.updateUser.mockResolvedValue({ error });
    return service.setPassword("password1");
  };

  it.each([
    ["invalid_credentials", "invalid_credentials"],
    ["otp_expired", "code_expired"],
    ["over_email_send_rate_limit", "rate_limited"],
    ["over_request_rate_limit", "rate_limited"],
    ["captcha_failed", "captcha_failed"],
    ["weak_password", "weak_password"],
  ])("コード%sを失敗の種類%sにする", async (code, kind) => {
    // Given
    const error = new AuthApiError("元の文言", 400, code);

    // When
    const result = await refusedWith(error);

    // Then
    expect(result).toEqual({ kind: "refused", failure: { kind } });
  });

  it("名前がAuthRetryableFetchErrorなら、コードがあっても届かなかった失敗にする", async () => {
    // Given
    const error = new AuthRetryableFetchError("fetch failed", 0);
    Object.assign(error, { code: "invalid_credentials" });

    // When
    const result = await refusedWith(error);

    // Then
    expect(result).toEqual({
      kind: "refused",
      failure: { kind: "unreachable" },
    });
  });

  it("コードが無い通信の断も届かなかった失敗にする", async () => {
    // Given
    const error = { name: "AuthRetryableFetchError", message: "fetch failed" };

    // When
    const result = await refusedWith(error);

    // Then
    expect(result).toEqual({
      kind: "refused",
      failure: { kind: "unreachable" },
    });
  });

  it.each([
    ["未知のコード", "unknown_code"],
    ["コードが無い場合", undefined],
    ["継承されたプロパティ名のコード", "toString"],
    ["継承されたconstructorのコード", "constructor"],
  ])("%sは認証サービスの文言を持つotherにする", async (_name, code) => {
    // Given
    const error = new AuthApiError("認証サービスの文言", 400, code);

    // When
    const result = await refusedWith(error);

    // Then
    expect(result).toEqual({
      kind: "refused",
      failure: { kind: "other", message: "認証サービスの文言" },
    });
  });
});

describe("サインイン(signIn)", () => {
  it("資格情報とトークンを認証サービスへ渡し、成功を受け付けられたで返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.signInWithPassword.mockResolvedValue({ error: null });

    // When
    const result = await service.signIn(credentials);

    // Then
    expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: credentials.email,
      password: credentials.password,
      options: { captchaToken: credentials.captchaToken },
    });
    expect(result).toEqual({ kind: "accepted" });
  });

  it("接続を作る関数は、認証の実装を作った時点では呼ばれない", () => {
    // Given

    // When
    const { getClient } = setup();

    // Then
    expect(getClient).not.toHaveBeenCalled();
  });

  it("接続を作る関数は、照合ごとに呼ばれる", async () => {
    // Given
    const { service, auth, getClient } = setup();
    auth.signInWithPassword.mockResolvedValue({ error: null });

    // When
    await service.signIn(credentials);
    await service.signIn(credentials);

    // Then
    expect(getClient).toHaveBeenCalledTimes(2);
  });

  it("拒否された認証エラーを失敗の種類にする", async () => {
    // Given
    const { service, auth } = setup();
    auth.signInWithPassword.mockResolvedValue({
      error: {
        name: "AuthApiError",
        code: "invalid_credentials",
        message: "raw",
      },
    });

    // When
    const result = await service.signIn(credentials);

    // Then
    expect(result).toEqual({
      kind: "refused",
      failure: { kind: "invalid_credentials" },
    });
  });

  it("再試行可能な通信エラーを通信断にする", async () => {
    // Given
    const { service, auth } = setup();
    auth.signInWithPassword.mockResolvedValue({
      error: { name: "AuthRetryableFetchError", message: "fetch failed" },
    });

    // When
    const result = await service.signIn(credentials);

    // Then
    expect(result).toEqual({
      kind: "refused",
      failure: { kind: "unreachable" },
    });
  });

  it("例外を通信断にする", async () => {
    // Given
    const { service, auth } = setup();
    auth.signInWithPassword.mockRejectedValue(new Error("network down"));

    // When
    const result = await service.signIn(credentials);

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it("接続を作る関数が投げると、通信断にする", async () => {
    // Given
    const { service, auth, getClient } = setup();
    getClient.mockImplementation(() => {
      throw new Error("Missing Supabase environment variables.");
    });

    // When
    const result = await service.signIn(credentials);

    // Then
    expect(result).toEqual({ kind: "unreachable" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("目的と範囲の違い", () => {
  it("コードの送信と確認は、目的で認証サービスの呼び出しを選ぶ", async () => {
    // Given
    const { service, auth } = setup();
    for (const mock of [
      auth.signInWithOtp,
      auth.resetPasswordForEmail,
      auth.verifyOtp,
    ]) {
      mock.mockResolvedValue({ error: null });
    }

    // When
    await service.sendCode({
      purpose: "sign-up",
      email: "a@b.co",
      captchaToken: "t",
    });
    await service.sendCode({
      purpose: "password-reset",
      email: "a@b.co",
      captchaToken: "t",
    });
    await service.verifyCode({
      purpose: "sign-up",
      email: "a@b.co",
      code: "1",
    });
    const signUpVerify = auth.verifyOtp.mock.lastCall;
    await service.verifyCode({
      purpose: "password-reset",
      email: "a@b.co",
      code: "1",
    });
    const resetVerify = auth.verifyOtp.mock.lastCall;

    // Then
    expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "a@b.co",
      options: { captchaToken: "t" },
    });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith(
      "a@b.co",
      { captchaToken: "t" },
    );
    expect(signUpVerify).toEqual([
      { email: "a@b.co", token: "1", type: "email" },
    ]);
    expect(resetVerify).toEqual([
      { email: "a@b.co", token: "1", type: "recovery" },
    ]);
  });

  it("サインアウトは、この端末だけと全ての端末を、範囲で選ぶ", async () => {
    // Given
    const { service, auth } = setup();
    auth.signOut.mockResolvedValue({ error: null });

    // When
    await service.signOutHere();
    const here = auth.signOut.mock.lastCall;
    await service.signOutEverywhere();
    const everywhere = auth.signOut.mock.lastCall;

    // Then
    expect(here).toEqual([{ scope: "local" }]);
    expect(everywhere).toEqual([{ scope: "global" }]);
  });
});

describe("コードの送信(sendCode)", () => {
  const signUp = {
    purpose: "sign-up",
    email: "user@example.com",
    captchaToken: "captcha-token",
  } as const;
  const reset = { ...signUp, purpose: "password-reset" } as const;

  it("メールアドレスとトークンを渡し、成功を受け付けられたで返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });

    // When
    const signUpResult = await service.sendCode(signUp);
    const resetResult = await service.sendCode(reset);

    // Then
    expect(signUpResult).toEqual({ kind: "accepted" });
    expect(resetResult).toEqual({ kind: "accepted" });
  });

  it.each([
    [
      "送信の間隔の制限",
      rateLimited,
      { kind: "refused", failure: { kind: "rate_limited" } },
    ],
    [
      "通信の断",
      connectionLost,
      { kind: "refused", failure: { kind: "unreachable" } },
    ],
  ])(
    "%sを値で返したら、応答があったとして拒否で返す",
    async (_name, error, expected) => {
      // Given
      const { service, auth } = setup();
      auth.signInWithOtp.mockResolvedValue({ error });
      auth.resetPasswordForEmail.mockResolvedValue({ error });

      // When
      const signUpResult = await service.sendCode(signUp);
      const resetResult = await service.sendCode(reset);

      // Then
      expect(signUpResult).toEqual(expected);
      expect(resetResult).toEqual(expected);
    },
  );

  it("呼び出しが投げたら、届かなかったとして返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.signInWithOtp.mockRejectedValue(new Error("network down"));
    auth.resetPasswordForEmail.mockRejectedValue(new Error("network down"));

    // When
    const signUpResult = await service.sendCode(signUp);
    const resetResult = await service.sendCode(reset);

    // Then
    expect(signUpResult).toEqual({ kind: "unreachable" });
    expect(resetResult).toEqual({ kind: "unreachable" });
  });

  it("接続を作れなければ、届かなかったとして返す", async () => {
    // Given
    const service = unavailableService();

    // When
    const signUpResult = await service.sendCode(signUp);
    const resetResult = await service.sendCode(reset);

    // Then
    expect(signUpResult).toEqual({ kind: "unreachable" });
    expect(resetResult).toEqual({ kind: "unreachable" });
  });
});

describe("コードの確認(verifyCode)", () => {
  const request = { email: "user@example.com", code: "123456" };

  it.each(["sign-up", "password-reset"] as const)(
    "目的%sで、メールアドレスとコードを渡し、成功を受け付けられたで返す",
    async (purpose) => {
      // Given
      const { service, auth } = setup();
      auth.verifyOtp.mockResolvedValue({ error: null });

      // When
      const result = await service.verifyCode({ purpose, ...request });

      // Then
      expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
        email: request.email,
        token: request.code,
        type: purpose === "sign-up" ? "email" : "recovery",
      });
      expect(result).toEqual({ kind: "accepted" });
    },
  );

  it("期限切れのエラーを値で返したら、コードの失敗に写して返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.verifyOtp.mockResolvedValue({ error: expired });

    // When
    const result = await service.verifyCode({ purpose: "sign-up", ...request });

    // Then
    expect(result).toEqual({
      kind: "refused",
      failure: { kind: "code_expired" },
    });
  });

  it("呼び出しが投げたら、届かなかった失敗として返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.verifyOtp.mockRejectedValue(new Error("network down"));

    // When
    const result = await service.verifyCode({
      purpose: "password-reset",
      ...request,
    });

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it("接続を作れなければ、届かなかった失敗として返す", async () => {
    // Given
    const service = unavailableService();

    // When
    const result = await service.verifyCode({ purpose: "sign-up", ...request });

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });
});

describe("パスワードの設定(setPassword)", () => {
  it("パスワードを渡し、成功を受け付けられたで返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.updateUser.mockResolvedValue({ error: null });

    // When
    const result = await service.setPassword("password1");

    // Then
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({
      password: "password1",
    });
    expect(result).toEqual({ kind: "accepted" });
  });

  it("弱いパスワードのエラーを値で返したら、その失敗に写して返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.updateUser.mockResolvedValue({ error: weakPassword });

    // When
    const result = await service.setPassword("password1");

    // Then
    expect(result).toEqual({
      kind: "refused",
      failure: { kind: "weak_password" },
    });
  });

  it("呼び出しが投げたら、届かなかった失敗として返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.updateUser.mockRejectedValue(new Error("network down"));

    // When
    const result = await service.setPassword("password1");

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it("接続を作れなければ、届かなかった失敗として返す", async () => {
    // Given
    const service = unavailableService();

    // When
    const result = await service.setPassword("password1");

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });
});

describe("全ての端末のサインアウト(signOutEverywhere)", () => {
  it("範囲にglobalを明示してサインアウトを依頼し、成功を受け付けられたで返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.signOut.mockResolvedValue({ error: null });

    // When
    const result = await service.signOutEverywhere();

    // Then
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "global" });
    expect(result).toEqual({ kind: "accepted" });
  });

  it("認証サービスが値のエラーを返したら、応答があった拒否として返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.signOut.mockResolvedValue({ error: connectionLost });

    // When
    const result = await service.signOutEverywhere();

    // Then
    expect(result).toEqual({
      kind: "refused",
      failure: { kind: "unreachable" },
    });
  });

  it("呼び出しが投げたら、届かなかった失敗として返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.signOut.mockRejectedValue(new Error("network down"));

    // When
    const result = await service.signOutEverywhere();

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it("接続を作れなければ、届かなかった失敗として返す", async () => {
    // Given
    const service = unavailableService();

    // When
    const result = await service.signOutEverywhere();

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });
});

describe("この端末のサインアウト(signOutHere)", () => {
  it("この端末のサインアウトだけを、scopeにlocalを指定して1回頼み、問題が無ければ受け付けられたを返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.signOut.mockResolvedValue({ error: null });

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({ kind: "accepted" });
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it.each([
    ["認証サービスの拒否", rateLimited, { kind: "rate_limited" }],
    ["通信の断の値", connectionLost, { kind: "unreachable" }],
    [
      "文言の表が無い拒否",
      new AuthApiError("unknown failure", 400, "some_unknown_code"),
      { kind: "other", message: "unknown failure" },
    ],
  ] as const)(
    "%sが値で返ったときは、拒否された失敗の種類にして返す",
    async (_name, error, failure) => {
      // Given
      const { service, auth } = setup();
      auth.signOut.mockResolvedValue({ error });

      // When
      const result = await service.signOutHere();

      // Then
      expect(result).toEqual({ kind: "refused", failure });
    },
  );

  it("呼び出しが投げたときは、届かなかった失敗にする", async () => {
    // Given
    const { service, auth } = setup();
    auth.signOut.mockRejectedValue(new TypeError("Failed to fetch"));

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it("接続を得られないときも、届かなかった失敗にする", async () => {
    // Given
    const service = unavailableService();

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });
});

describe("サインインの状態の確認(readSession)", () => {
  it.each([
    [
      "保存先にセッションがあれば認証済み",
      { data: { session: { user: { id: "user-1" } } }, error: null },
      { status: "authenticated", userId: "user-1" },
    ],
    [
      "保存先が空でエラーが無ければ未認証",
      { data: { session: null }, error: null },
      { status: "unauthenticated" },
    ],
    [
      "通信失敗は不明",
      { data: { session: null }, error: connectionLost },
      { status: "unknown" },
    ],
  ] as const)("%s", async (_name, result, expected) => {
    // Given
    const { service, auth } = setup();
    auth.getSession.mockResolvedValue(result);

    // When
    const status = await service.readSession();

    // Then
    expect(status).toEqual(expected);
  });

  it("確認が投げたときは、不明にする", async () => {
    // Given
    const { service, auth } = setup();
    auth.getSession.mockRejectedValue(new Error("storage"));

    // When
    const status = await service.readSession();

    // Then
    expect(status).toEqual({ status: "unknown" });
  });
});

describe("認証状態の購読(subscribe)", () => {
  it.each([
    [
      "SIGNED_IN",
      { user: { id: "user-1" } },
      { kind: "signed-in", userId: "user-1" },
    ],
    [
      "INITIAL_SESSION",
      { user: { id: "user-1" } },
      { kind: "initial", userId: "user-1" },
    ],
    ["INITIAL_SESSION", null, { kind: "initial", userId: null }],
    ["SIGNED_OUT", null, { kind: "signed-out" }],
    ["TOKEN_REFRESHED", { user: { id: "user-1" } }, { kind: "other" }],
  ] as const)(
    "%sを内側の出来事に写して知らせる",
    (event, session, expected) => {
      // Given
      const { service, emit } = setup();
      const received: AuthChange[] = [];
      service.subscribe((change) => received.push(change));

      // When
      emit(event, session);

      // Then
      expect(received).toEqual([expected]);
    },
  );

  it("返す関数で購読を解除する", () => {
    // Given
    const { service, unsubscribe } = setup();
    const stop = service.subscribe(() => {});

    // When
    stop();

    // Then
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("解除した後の出来事は、知らせない", () => {
    // Given
    const { service, emit } = setup();
    const received: AuthChange[] = [];
    const stop = service.subscribe((change) => received.push(change));
    stop();

    // When
    emit("SIGNED_OUT", null);

    // Then
    expect(received).toEqual([]);
  });
});

// 保存先のセッションを読む認証サービスの偽。
const SESSION = { user: { id: "user-1" } } as Session;

type Result = { data: { session: Session | null }; error: AuthError | null };

function withSession(): Result {
  return { data: { session: SESSION }, error: null };
}

function withError(error: AuthError | null): Result {
  return { data: { session: null }, error };
}

function rejection(): AuthError {
  return new AuthApiError(
    "invalid refresh token",
    400,
    "refresh_token_not_found",
  );
}

// getSession()とrefreshSession()は、呼ばれた順に結果を返す。
function createSupabase({
  getSession = [],
  refreshSession = [],
}: {
  getSession?: Result[];
  refreshSession?: Result[];
}) {
  const auth = {
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
  };
  for (const result of getSession) {
    auth.getSession.mockResolvedValueOnce(result);
  }
  for (const result of refreshSession) {
    auth.refreshSession.mockResolvedValueOnce(result);
  }
  const supabase = { auth } as unknown as Pick<SupabaseClient, "auth">;
  return { supabase, auth };
}

// 読み取りの試験で用いる、認証サービスの実装と偽の接続の組。
function readSessionOf(
  supabase: Pick<SupabaseClient, "auth">,
  options?: { refresh?: boolean },
) {
  return createSupabaseAuth(() => supabase).readSession(options);
}

describe("サインインの状態の読み取り(readSession)", () => {
  describe("保存先を読む場合", () => {
    it("セッションがあれば、エラーの有無にかかわらず認証済みとしてセッションを返す", async () => {
      // Given
      const plain = createSupabase({ getSession: [withSession()] });
      const errored = createSupabase({
        getSession: [
          {
            data: { session: SESSION },
            error: new AuthRetryableFetchError("fetch failed", 0),
          },
        ],
      });

      // When
      const states = [
        await readSessionOf(plain.supabase),
        await readSessionOf(errored.supabase),
      ];

      // Then
      expect(states).toEqual([
        { status: "authenticated", userId: "user-1" },
        { status: "authenticated", userId: "user-1" },
      ]);
    });

    it("セッションがなくエラーもなければ、保存先を消さずに未認証にする", async () => {
      // Given
      const { supabase, auth } = createSupabase({
        getSession: [withError(null)],
      });

      // When
      const state = await readSessionOf(supabase);

      // Then
      expect(state).toEqual({ status: "unauthenticated" });
      expect(auth.signOut).not.toHaveBeenCalled();
    });

    it("通信失敗は、ステータスにかかわらず不明としてエラーを保持して返す", async () => {
      // Given
      const networkError = new AuthRetryableFetchError("fetch failed", 0);
      const serverError = new AuthRetryableFetchError("unavailable", 503);
      const network = createSupabase({ getSession: [withError(networkError)] });
      const server = createSupabase({ getSession: [withError(serverError)] });

      // When
      const states = [
        await readSessionOf(network.supabase),
        await readSessionOf(server.supabase),
      ];

      // Then
      expect(states).toEqual([{ status: "unknown" }, { status: "unknown" }]);
      expect(network.auth.signOut).not.toHaveBeenCalled();
      expect(server.auth.signOut).not.toHaveBeenCalled();
    });

    describe("更新の結果が破棄された場合", () => {
      it("保存先を読み直し、別の書き手のセッションがあれば認証済みにする", async () => {
        // Given
        const { supabase, auth } = createSupabase({
          getSession: [
            withError(new AuthRefreshDiscardedError()),
            withSession(),
          ],
        });

        // When
        const state = await readSessionOf(supabase);

        // Then
        expect(state).toEqual({ status: "authenticated", userId: "user-1" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("破棄が続いても、読み直してセッションがあれば認証済みにする", async () => {
        // Given
        const { supabase, auth } = createSupabase({
          getSession: [
            withError(new AuthRefreshDiscardedError()),
            withError(new AuthRefreshDiscardedError()),
            withSession(),
          ],
        });

        // When
        const state = await readSessionOf(supabase);

        // Then
        expect(state).toEqual({ status: "authenticated", userId: "user-1" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("読み直して保存先が空なら、未認証にする", async () => {
        // Given
        const { supabase, auth } = createSupabase({
          getSession: [
            withError(new AuthRefreshDiscardedError()),
            withError(null),
          ],
        });

        // When
        const state = await readSessionOf(supabase);

        // Then
        // 保存先は既に空のため、サインアウトしない。
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });
    });

    describe("更新が拒否された場合", () => {
      it("別の書き手と重なった拒否なら、読み直してセッションがあれば認証済みにする", async () => {
        // Given
        const { supabase, auth } = createSupabase({
          getSession: [withError(rejection()), withSession()],
        });

        // When
        const state = await readSessionOf(supabase);

        // Then
        expect(state).toEqual({ status: "authenticated", userId: "user-1" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("別の拒否が続く間は、保存先を読み直し続ける", async () => {
        // Given
        const { supabase, auth } = createSupabase({
          getSession: [
            withError(rejection()),
            withError(rejection()),
            withSession(),
          ],
        });

        // When
        const state = await readSessionOf(supabase);

        // Then
        expect(state).toEqual({ status: "authenticated", userId: "user-1" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("読み直して保存先が空なら、未認証にする", async () => {
        // Given
        // 拒否でauth-jsが保存先を消した。
        const { supabase, auth } = createSupabase({
          getSession: [withError(rejection()), withError(null)],
        });

        // When
        const state = await readSessionOf(supabase);

        // Then
        // 保存先は既に空のため、サインアウトしない。
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("読み直しても同じ拒否が返れば、保存先を空にして未認証にする", async () => {
        // Given
        // 保存先が拒否されたセッションのまま変わらず、auth-jsが記憶した同じ拒否を返す。
        const error = rejection();
        const { supabase, auth } = createSupabase({
          getSession: [withError(error), withError(error)],
        });

        // When
        const state = await readSessionOf(supabase);

        // Then
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({
          scope: "local",
        });
      });
    });
  });

  describe("更新を強制する場合", () => {
    // 保存先のセッション(更新トークンRT1)と、別の書き手が書いたセッション(RT2)。
    const storedSession = {
      user: { id: "user-1" },
      refresh_token: "rt-1",
    } as Session;
    const otherSession = {
      user: { id: "user-1" },
      refresh_token: "rt-2",
    } as Session;
    const stored = (): Result => ({
      data: { session: storedSession },
      error: null,
    });
    const other = (): Result => ({
      data: { session: otherSession },
      error: null,
    });

    it("更新できれば、保存先の更新トークンで更新した新しいセッションで認証済みにする", async () => {
      // Given
      const { supabase, auth } = createSupabase({
        getSession: [stored()],
        refreshSession: [other()],
      });

      // When
      const state = await readSessionOf(supabase, { refresh: true });

      // Then
      expect(state).toEqual({ status: "authenticated", userId: "user-1" });
      expect(auth.refreshSession).toHaveBeenCalledExactlyOnceWith({
        refresh_token: "rt-1",
      });
    });

    it("保存先にセッションが無ければ、更新せずに未認証にする", async () => {
      // Given
      const { supabase, auth } = createSupabase({
        getSession: [withError(null)],
      });

      // When
      const state = await readSessionOf(supabase, { refresh: true });

      // Then
      expect(state).toEqual({ status: "unauthenticated" });
      expect(auth.refreshSession).not.toHaveBeenCalled();
    });

    it("更新の結果が破棄されれば、保存先を読み直した結果で判定する", async () => {
      // Given
      const { supabase, auth } = createSupabase({
        getSession: [stored(), other()],
        refreshSession: [withError(new AuthRefreshDiscardedError())],
      });

      // When
      const state = await readSessionOf(supabase, { refresh: true });

      // Then
      expect(state).toEqual({ status: "authenticated", userId: "user-1" });
      expect(auth.signOut).not.toHaveBeenCalled();
    });

    it("更新の通信が失敗すれば、不明にする", async () => {
      // Given
      const { supabase, auth } = createSupabase({
        getSession: [stored()],
        refreshSession: [
          withError(new AuthRetryableFetchError("fetch failed", 0)),
        ],
      });

      // When
      const state = await readSessionOf(supabase, { refresh: true });

      // Then
      expect(state).toEqual({ status: "unknown" });
      expect(auth.signOut).not.toHaveBeenCalled();
    });

    describe("更新が拒否された場合", () => {
      it("読み直しても保存先が拒否された更新トークンのままなら、保存先を空にして未認証にする", async () => {
        // Given
        // 拒否の後も、アクセストークンが未失効のため保存先にRT1のセッションが残る。
        const { supabase, auth } = createSupabase({
          getSession: [stored(), stored()],
          refreshSession: [withError(rejection())],
        });

        // When
        const state = await readSessionOf(supabase, { refresh: true });

        // Then
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({
          scope: "local",
        });
      });

      it("読み直しても同じ拒否が返れば、保存先を空にして未認証にする", async () => {
        // Given
        // 保存先がRT1のままで、auth-jsが記憶した同じ拒否を返す。
        const error = rejection();
        const { supabase, auth } = createSupabase({
          getSession: [stored(), withError(error)],
          refreshSession: [withError(error)],
        });

        // When
        const state = await readSessionOf(supabase, { refresh: true });

        // Then
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({
          scope: "local",
        });
      });

      it("読み直して保存先が空なら、未認証にする", async () => {
        // Given
        // 拒否でauth-jsが保存先を消した。
        const { supabase, auth } = createSupabase({
          getSession: [stored(), withError(null)],
          refreshSession: [withError(rejection())],
        });

        // When
        const state = await readSessionOf(supabase, { refresh: true });

        // Then
        // 保存先は既に空のため、サインアウトしない。
        expect(state).toEqual({ status: "unauthenticated" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });

      it("読み直して別の書き手が書き換えた更新トークンなら、保存先を消さずに認証済みにする", async () => {
        // Given
        const { supabase, auth } = createSupabase({
          getSession: [stored(), other()],
          refreshSession: [withError(rejection())],
        });

        // When
        const state = await readSessionOf(supabase, { refresh: true });

        // Then
        expect(state).toEqual({ status: "authenticated", userId: "user-1" });
        expect(auth.signOut).not.toHaveBeenCalled();
      });
    });
  });
});

import {
  AuthApiError,
  type AuthError,
  AuthRefreshDiscardedError,
  AuthRetryableFetchError,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { SignInChange } from "../application/auth-changes";
import { createSupabaseAuth } from "./supabase-auth";

const rateLimited = new AuthApiError(
  "rate limit",
  429,
  "over_email_send_rate_limit",
);
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
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    resend: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    admin: { signOut: vi.fn() },
    getSession: vi.fn(),
    getUser: vi.fn(),
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

describe("メールアドレスの変更(readCurrentEmail、requestEmailChange、confirmEmailChange、resendEmailChangeCode)", () => {
  const newEmail = "new@example.com";
  const currentEmail = "current@example.com";
  const unreachable = { kind: "failed", failure: { kind: "unreachable" } };

  describe("現在のメールアドレスの読み取り", () => {
    it("セッションがあればそのメールアドレスを返し、無いときと読み取りが投げたときは不明にする", async () => {
      // Given
      const withSession = setup();
      withSession.auth.getSession.mockResolvedValue({
        data: { session: { user: { email: currentEmail } } },
      });
      const without = setup();
      without.auth.getSession.mockResolvedValue({ data: { session: null } });
      const thrown = setup();
      thrown.auth.getSession.mockRejectedValue(new Error("storage"));

      // When
      const found = await withSession.service.readCurrentEmail();
      const none = await without.service.readCurrentEmail();
      const failed = await thrown.service.readCurrentEmail();

      // Then
      expect(found).toBe(currentEmail);
      expect(none).toBeNull();
      expect(failed).toBeNull();
    });
  });

  describe("要求(requestEmailChange)", () => {
    it("新しいメールアドレスだけをupdateUserへ1回渡し、受け付けと応答の現在のメールアドレスを返す", async () => {
      // Given
      const { service, auth } = setup();
      auth.updateUser.mockResolvedValue({
        data: { user: { email: currentEmail } },
        error: null,
      });

      // When
      const result = await service.requestEmailChange({ newEmail });

      // Then
      expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({
        email: newEmail,
      });
      expect(result).toEqual({ kind: "accepted", currentEmail });
    });

    it("保留中の変更のnew_emailがあっても、応答の現在のメールアドレスだけを返す", async () => {
      // Given
      const { service, auth } = setup();
      auth.updateUser.mockResolvedValue({
        data: {
          user: { email: currentEmail, new_email: "previous@example.com" },
        },
        error: null,
      });

      // When
      const result = await service.requestEmailChange({ newEmail });

      // Then
      expect(result).toEqual({ kind: "accepted", currentEmail });
    });

    it("応答の現在のメールアドレスが要求と同じなら、保留中のnew_emailがあっても、同じメールアドレスにする", async () => {
      // Given
      const { service, auth } = setup();
      auth.updateUser.mockResolvedValue({
        data: {
          user: { email: currentEmail, new_email: "previous@example.com" },
        },
        error: null,
      });

      // When
      const result = await service.requestEmailChange({
        newEmail: currentEmail,
      });

      // Then
      expect(result).toEqual({
        kind: "failed",
        failure: { kind: "same_email" },
      });
    });

    it.each([
      [
        "422 email_exists",
        { error: new AuthApiError("exists", 422, "email_exists") },
        "email_exists",
      ],
      [
        "200で現在のメールアドレスが要求と同じ",
        { data: { user: { email: newEmail } }, error: null },
        "same_email",
      ],
      [
        "200で現在のメールアドレスが大文字小文字だけ違う",
        { data: { user: { email: newEmail.toUpperCase() } }, error: null },
        "same_email",
      ],
      [
        "429 over_email_send_rate_limit",
        { error: rateLimited },
        "rate_limited",
      ],
      [
        "429 over_request_rate_limit",
        { error: new AuthApiError("rate", 429, "over_request_rate_limit") },
        "rate_limited",
      ],
      ["再試行可能な通信エラー", { error: connectionLost }, "unreachable"],
      [
        "その他のコード",
        { error: new AuthApiError("x", 400, "some_unknown_code") },
        "other",
      ],
      [
        "200で応答に現在のメールアドレスが無い",
        { data: { user: {} }, error: null },
        "other",
      ],
    ])("応答%sを、%sの失敗にする", async (_name, response, kind) => {
      // Given
      const { service, auth } = setup();
      auth.updateUser.mockResolvedValue(response);

      // When
      const result = await service.requestEmailChange({ newEmail });

      // Then
      expect(result).toEqual({ kind: "failed", failure: { kind } });
    });
  });

  describe("確認(confirmEmailChange)", () => {
    it.each([
      [
        "一方だけの確認(利用者もセッションも返さない)",
        { user: null, session: null },
        "partial",
      ],
      [
        "両方の確認(セッションを返す)",
        { user: { id: "u" }, session: { access_token: "t" } },
        "completed",
      ],
    ])(
      "%sは、アドレスとコードをtype email_changeで渡し、%sにする",
      async (_name, data, kind) => {
        // Given
        const { service, auth } = setup();
        auth.verifyOtp.mockResolvedValue({ data, error: null });

        // When
        const result = await service.confirmEmailChange({
          email: currentEmail,
          code: "123456",
        });

        // Then
        expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
          email: currentEmail,
          token: "123456",
          type: "email_change",
        });
        expect(result).toEqual({ kind });
      },
    );

    it.each([
      [
        "403 otp_expired",
        new AuthApiError("expired", 403, "otp_expired"),
        "code_expired",
      ],
      ["429 over_email_send_rate_limit", rateLimited, "rate_limited"],
      [
        "429 over_request_rate_limit",
        new AuthApiError("rate", 429, "over_request_rate_limit"),
        "rate_limited",
      ],
      [
        "500でコードの無いAuthRetryableFetchError",
        new AuthRetryableFetchError("boom", 500),
        "unreachable",
      ],
      [
        "その他のコード",
        new AuthApiError("x", 400, "some_unknown_code"),
        "other",
      ],
    ])("応答%sを、%sの失敗にする", async (_name, error, kind) => {
      // Given
      const { service, auth } = setup();
      auth.verifyOtp.mockResolvedValue({ data: {}, error });

      // When
      const result = await service.confirmEmailChange({
        email: newEmail,
        code: "123456",
      });

      // Then
      expect(result).toEqual({ kind: "failed", failure: { kind } });
    });
  });

  describe("再送(resendEmailChangeCode)", () => {
    it("現在のメールアドレスとトークンをtype email_changeでresendへ1回渡し、受け付けにする", async () => {
      // Given
      const { service, auth } = setup();
      auth.resend.mockResolvedValue({ error: null });

      // When
      const result = await service.resendEmailChangeCode({
        email: currentEmail,
        captchaToken: "token",
      });

      // Then
      expect(auth.resend).toHaveBeenCalledExactlyOnceWith({
        type: "email_change",
        email: currentEmail,
        options: { captchaToken: "token" },
      });
      expect(result).toEqual({ kind: "accepted" });
    });

    it.each([
      [
        "400 captcha_failed",
        new AuthApiError("captcha", 400, "captcha_failed"),
        "captcha_failed",
      ],
      ["429 over_email_send_rate_limit", rateLimited, "rate_limited"],
      ["通信の断", connectionLost, "unreachable"],
      [
        "その他のコード",
        new AuthApiError("x", 400, "some_unknown_code"),
        "other",
      ],
    ])("応答%sを、%sの失敗にする", async (_name, error, kind) => {
      // Given
      const { service, auth } = setup();
      auth.resend.mockResolvedValue({ error });

      // When
      const result = await service.resendEmailChangeCode({
        email: currentEmail,
        captchaToken: "token",
      });

      // Then
      expect(result).toEqual({ kind: "failed", failure: { kind } });
    });
  });

  describe("呼び出しが投げたとき、接続を得られないとき", () => {
    it("要求・確認・再送は届かなかった失敗にし、読み取りは不明にする", async () => {
      // Given
      const thrown = setup();
      thrown.auth.updateUser.mockRejectedValue(new Error("network down"));
      thrown.auth.verifyOtp.mockRejectedValue(new Error("network down"));
      thrown.auth.resend.mockRejectedValue(new Error("network down"));
      const service = unavailableService();

      // When
      const results = [
        await thrown.service.requestEmailChange({ newEmail }),
        await thrown.service.confirmEmailChange({ email: newEmail, code: "1" }),
        await thrown.service.resendEmailChangeCode({
          email: currentEmail,
          captchaToken: "t",
        }),
        await service.requestEmailChange({ newEmail }),
        await service.confirmEmailChange({ email: newEmail, code: "1" }),
        await service.resendEmailChangeCode({
          email: currentEmail,
          captchaToken: "t",
        }),
      ];
      const reading = await service.readCurrentEmail();

      // Then
      for (const result of results) expect(result).toEqual(unreachable);
      expect(reading).toBeNull();
    });
  });
});

const serverError = new AuthApiError("server error", 500, "unexpected_failure");
const session = { access_token: "access-token-1" } as Session;

describe("この端末のサインアウト(signOutHere)", () => {
  function setupWithSession() {
    const made = setup();
    made.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    made.auth.admin.signOut.mockResolvedValue({ error: null });
    made.auth.signOut.mockResolvedValue({ error: null });
    return made;
  }

  it("失効が受け付けられたら、アクセストークンとlocalで1回頼んだ後に保存先を削除し、受け付けられたを返す", async () => {
    // Given
    const { service, auth } = setupWithSession();

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({ kind: "accepted" });
    expect(auth.admin.signOut).toHaveBeenCalledExactlyOnceWith(
      "access-token-1",
      "local",
    );
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(auth.admin.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      auth.signOut.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it.each([
    ["401", 401],
    ["403", 403],
    ["404", 404],
  ] as const)(
    "失効の頼みが%sで拒否されたときは、失効済みとして保存先を削除し、受け付けられたを返す",
    async (_name, status) => {
      // Given
      const { service, auth } = setupWithSession();
      auth.admin.signOut.mockResolvedValue({
        error: new AuthApiError("gone", status, "session_not_found"),
      });

      // When
      const result = await service.signOutHere();

      // Then
      expect(result).toEqual({ kind: "accepted" });
      expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    },
  );

  it.each([
    ["通信の断の値", connectionLost, { kind: "unreachable" }],
    ["サーバーの失敗(500)", serverError, { kind: "other" }],
    ["認証サービスの拒否(429)", rateLimited, { kind: "rate_limited" }],
    [
      "その他の拒否(400)",
      new AuthApiError("bad request", 400, "some_unknown_code"),
      { kind: "other" },
    ],
  ] as const)(
    "失効の頼みが%sで返ったときは、保存先を削除せず、その失敗の種類で返す",
    async (_name, error, failure) => {
      // Given
      const { service, auth } = setupWithSession();
      auth.admin.signOut.mockResolvedValue({ error });

      // When
      const result = await service.signOutHere();

      // Then
      expect(result).toEqual({ kind: "failed", failure });
      expect(auth.signOut).not.toHaveBeenCalled();
    },
  );

  it("失効の頼みが投げたときは、保存先を削除せず、届かなかった失敗にする", async () => {
    // Given
    const { service, auth } = setupWithSession();
    auth.admin.signOut.mockRejectedValue(new TypeError("Failed to fetch"));

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("保存先にセッションが無いときは、失効を頼まず、保存先を整理して受け付けられたを返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.signOut.mockResolvedValue({ error: null });

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({ kind: "accepted" });
    expect(auth.admin.signOut).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it("保存先のセッションを取得できない(エラーを返す)ときは、何も頼まず、その失敗の種類で返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: rateLimited,
    });

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "rate_limited" },
    });
    expect(auth.admin.signOut).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("保存先のセッションの取得が投げたときは、何も頼まず、届かなかった失敗にする", async () => {
    // Given
    const { service, auth } = setup();
    auth.getSession.mockRejectedValue(new Error("storage"));

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
    expect(auth.admin.signOut).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("保存先の削除がエラーを返しても、失効済みのため、受け付けられたを返す", async () => {
    // Given
    const { service, auth } = setupWithSession();
    auth.signOut.mockResolvedValue({ error: rateLimited });

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({ kind: "accepted" });
  });

  it("接続を得られないときも、届かなかった失敗にする", async () => {
    // Given
    const service = unavailableService();

    // When
    const result = await service.signOutHere();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
  });
});

describe("保存先のセッションの削除(discardHere)", () => {
  it("scopeにlocalを指定して1回頼み、失効の頼み(admin.signOut)はせず、問題が無ければ受け付けられたを返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.signOut.mockResolvedValue({ error: null });

    // When
    const result = await service.discardHere();

    // Then
    expect(result).toEqual({ kind: "accepted" });
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    expect(auth.admin.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ["認証サービスの拒否", rateLimited, { kind: "rate_limited" }],
    ["通信の断の値", connectionLost, { kind: "unreachable" }],
    [
      "文言の表が無い拒否",
      new AuthApiError("unknown failure", 400, "some_unknown_code"),
      { kind: "other" },
    ],
  ] as const)(
    "%sが値で返ったときは、拒否された失敗の種類にして返す",
    async (_name, error, failure) => {
      // Given
      const { service, auth } = setup();
      auth.signOut.mockResolvedValue({ error });

      // When
      const result = await service.discardHere();

      // Then
      expect(result).toEqual({ kind: "failed", failure });
    },
  );

  it("呼び出しが投げたときは、届かなかった失敗にする", async () => {
    // Given
    const { service, auth } = setup();
    auth.signOut.mockRejectedValue(new TypeError("Failed to fetch"));

    // When
    const result = await service.discardHere();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
  });

  it("接続を得られないときも、届かなかった失敗にする", async () => {
    // Given
    const service = unavailableService();

    // When
    const result = await service.discardHere();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
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
    ["SIGNED_IN", { user: { id: "user-1" } }, "user-1"],
    ["INITIAL_SESSION", { user: { id: "user-1" } }, "user-1"],
  ] as const)(
    "%s(利用者あり)を、signed-inに写して知らせる",
    (event, session, userId) => {
      // Given
      const { service, emit } = setup();
      const received: SignInChange[] = [];
      service.subscribe((change) => received.push(change));

      // When
      emit(event, session);

      // Then
      expect(received).toEqual([{ kind: "signed-in", userId }]);
    },
  );

  it("TOKEN_REFRESHED(利用者あり)は、知らせない", () => {
    // Given
    const { service, emit } = setup();
    const received: SignInChange[] = [];
    service.subscribe((change) => received.push(change));

    // When
    emit("TOKEN_REFRESHED", { user: { id: "user-1" } });

    // Then
    expect(received).toEqual([]);
  });

  it("SIGNED_OUTを、signed-outに写して知らせる", () => {
    // Given
    const { service, emit } = setup();
    const received: SignInChange[] = [];
    service.subscribe((change) => received.push(change));

    // When
    emit("SIGNED_OUT", null);

    // Then
    expect(received).toEqual([{ kind: "signed-out" }]);
  });

  it.each([
    ["INITIAL_SESSION(利用者なし)", "INITIAL_SESSION", null],
    ["TOKEN_REFRESHED(利用者なし)", "TOKEN_REFRESHED", null],
    ["PASSWORD_RECOVERY", "PASSWORD_RECOVERY", { user: { id: "user-1" } }],
    ["USER_UPDATED", "USER_UPDATED", { user: { id: "user-1" } }],
  ] as const)("%sは、知らせない", (_name, event, session) => {
    // Given
    const { service, emit } = setup();
    const received: SignInChange[] = [];
    service.subscribe((change) => received.push(change));

    // When
    emit(event, session);

    // Then
    expect(received).toEqual([]);
  });

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
    const received: SignInChange[] = [];
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

describe("標準メールOTPのアダプター", () => {
  it.each([true, false])(
    "登録可否%sとCAPTCHAをSDKへ渡す",
    async (shouldCreateUser) => {
      // Given
      const { service, auth } = setup();
      auth.signInWithOtp.mockResolvedValue({ error: null });
      // When
      const result = await service.sendCode({
        email: "archer@example.test",
        captchaToken: "check",
        shouldCreateUser,
      });
      // Then
      expect(result).toEqual({ kind: "accepted" });
      expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
        email: "archer@example.test",
        options: { captchaToken: "check", shouldCreateUser },
      });
    },
  );
  it("未登録拒否だけを送付受理へ写す", async () => {
    // Given
    const { service, auth } = setup();
    auth.signInWithOtp.mockResolvedValue({
      error: new AuthApiError("disabled", 400, "otp_disabled"),
    });
    // When
    const result = await service.sendCode({
      email: "archer@example.test",
      captchaToken: "check",
      shouldCreateUser: false,
    });
    // Then
    expect(result).toEqual({ kind: "accepted" });
  });
  it.each([
    [new AuthApiError("expired", 403, "otp_expired"), "code_expired"],
    [rateLimited, "rate_limited"],
    [new AuthApiError("captcha", 400, "captcha_failed"), "captcha_failed"],
    [connectionLost, "unreachable"],
    [new AuthApiError("unknown", 400, "unknown"), "other"],
  ] as const)("送付失敗を内側の%sへ変換する", async (error, kind) => {
    // Given
    const { service, auth } = setup();
    auth.signInWithOtp.mockResolvedValue({ error });
    // When
    const result = await service.sendCode({
      email: "archer@example.test",
      captchaToken: "check",
      shouldCreateUser: false,
    });
    // Then
    expect(result).toEqual({ kind: "failed", failure: { kind } });
  });
  it("確認成功のセッションと利用者が揃えば、利用者IDを持たない確認済みの結果を返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.verifyOtp.mockResolvedValue({
      data: { session: {}, user: { id: "user-1" } },
      error: null,
    });
    // When
    const result = await service.verifyCode({
      email: "archer@example.test",
      code: "123456",
    });
    // Then
    expect(result).toEqual({ kind: "verified" });
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      email: "archer@example.test",
      token: "123456",
      type: "email",
    });
  });
  it.each([
    { session: null, user: { id: "user-1" } },
    { session: {}, user: null },
  ])("確認成功でもセッションと利用者が揃わなければ失敗する", async (data) => {
    // Given
    const { service, auth } = setup();
    auth.verifyOtp.mockResolvedValue({ data, error: null });
    // When
    const result = await service.verifyCode({
      email: "archer@example.test",
      code: "123456",
    });
    // Then
    expect(result).toEqual({ kind: "failed", failure: { kind: "other" } });
  });
  it("削除対象はgetUserで検証したIDとメールを返す", async () => {
    // Given
    const { service, auth } = setup();
    auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "archer@example.test" } },
      error: null,
    });
    // When
    const result = await service.readCurrentAccount();
    // Then
    expect(result).toEqual({
      kind: "current",
      userId: "user-1",
      email: "archer@example.test",
    });
  });
  it("確認の接続取得失敗をunreachableへ写す", async () => {
    // Given
    const service = unavailableService();
    // When
    const result = await service.verifyCode({
      email: "archer@example.test",
      code: "123456",
    });
    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
  });
});

it("登録可の送信に対するotp_disabledを成功へ変換しない", async () => {
  // Given
  const { service, auth } = setup();
  auth.signInWithOtp.mockResolvedValue({
    error: new AuthApiError("disabled", 400, "otp_disabled"),
  });
  // When
  const result = await service.sendCode({
    email: "archer@example.test",
    captchaToken: "check",
    shouldCreateUser: true,
  });
  // Then
  expect(result).toEqual({ kind: "failed", failure: { kind: "other" } });
});

it.each([401, 403])("現在利用者の%sは認証喪失として返す", async (status) => {
  // Given
  const { service, auth } = setup();
  auth.getUser.mockResolvedValue({
    data: { user: null },
    error: new AuthApiError("rejected", status, "bad_jwt"),
  });
  // When
  const result = await service.readCurrentAccount();
  // Then
  expect(result).toEqual({ kind: "lost" });
});

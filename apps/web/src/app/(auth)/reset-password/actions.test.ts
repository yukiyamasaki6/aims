import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changePassword } from "./actions";

// 要求のcookie(Next.js)と、SDKの接続の生成は境界のため差し替える。
// サーバーの接続(createServerClient)、サーバーの手続き(createPasswordChange)、認証の実装(createSupabaseAuth)は実物を通す。
const request = vi.hoisted(() => ({
  store: { getAll: vi.fn(), set: vi.fn() },
  cookies: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: request.cookies }));

const sdk = vi.hoisted(() => ({
  auth: { updateUser: vi.fn(), signOut: vi.fn() },
  createServerClient: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: sdk.createServerClient,
}));

const weakPassword = new AuthApiError(
  "Password is known to be weak",
  422,
  "weak_password",
);

beforeEach(() => {
  vi.resetAllMocks();
  request.cookies.mockResolvedValue(request.store);
  request.store.getAll.mockReturnValue([
    { name: "sb-example-auth-token", value: "session" },
  ]);
  sdk.createServerClient.mockImplementation(() => ({ auth: sdk.auth }));
  sdk.auth.updateUser.mockResolvedValue({ error: null });
  sdk.auth.signOut.mockResolvedValue({ error: null });
});

describe("changePassword(パスワード変更の要求の入口)", () => {
  it("要求のcookieを読み書きする1つの接続で、パスワードを変更した後に全端末の終了を頼み、変更の成功を返す", async () => {
    // Given

    // When
    const result = await changePassword("newPassword123");

    // Then
    expect(result).toEqual({ kind: "accepted" });
    expect(sdk.createServerClient).toHaveBeenCalledOnce();
    const cookieOptions = sdk.createServerClient.mock.calls[0]?.[2].cookies;
    expect(cookieOptions.getAll()).toEqual([
      { name: "sb-example-auth-token", value: "session" },
    ]);
    expect(sdk.auth.updateUser).toHaveBeenCalledExactlyOnceWith({
      password: "newPassword123",
    });
    expect(sdk.auth.signOut).toHaveBeenCalledExactlyOnceWith({
      scope: "global",
    });
    expect(sdk.auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.auth.signOut.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("終了で消えたセッションのcookieを、要求の応答へ書き戻す", async () => {
    // Given
    const removed = { path: "/", maxAge: 0 };
    sdk.auth.signOut.mockImplementation(async () => {
      const cookieOptions = sdk.createServerClient.mock.calls[0]?.[2].cookies;
      cookieOptions.setAll([
        { name: "sb-example-auth-token", value: "", options: removed },
      ]);
      return { error: null };
    });

    // When
    await changePassword("newPassword123");

    // Then
    expect(request.store.set).toHaveBeenCalledExactlyOnceWith(
      "sb-example-auth-token",
      "",
      removed,
    );
  });

  it.each([
    [
      "拒否",
      {
        error: new AuthApiError("Rate limited", 429, "over_request_rate_limit"),
      },
    ],
    ["通信の断", { error: new AuthRetryableFetchError("fetch failed", 0) }],
  ])(
    "終了が%sを返しても、変更の成功だけを返す",
    async (_name, signOutResponse) => {
      // Given
      sdk.auth.signOut.mockResolvedValue(signOutResponse);

      // When
      const result = await changePassword("newPassword123");

      // Then
      expect(result).toEqual({ kind: "accepted" });
    },
  );

  it("終了の呼び出しが投げても、変更の成功だけを返す", async () => {
    // Given
    sdk.auth.signOut.mockRejectedValue(new TypeError("fetch failed"));

    // When
    const result = await changePassword("newPassword123");

    // Then
    expect(result).toEqual({ kind: "accepted" });
  });

  it("変更が拒否されたら、その結果を返し、終了を頼まない", async () => {
    // Given
    sdk.auth.updateUser.mockResolvedValue({ error: weakPassword });

    // When
    const result = await changePassword("weakpass1");

    // Then
    expect(result).toEqual({
      kind: "refused",
      failure: { kind: "weak_password" },
    });
    expect(sdk.auth.signOut).not.toHaveBeenCalled();
  });

  it("変更の呼び出しが投げたら、届かなかった結果を返し、終了を頼まない", async () => {
    // Given
    sdk.auth.updateUser.mockRejectedValue(new TypeError("fetch failed"));

    // When
    const result = await changePassword("newPassword123");

    // Then
    expect(result).toEqual({ kind: "unreachable" });
    expect(sdk.auth.signOut).not.toHaveBeenCalled();
  });
});

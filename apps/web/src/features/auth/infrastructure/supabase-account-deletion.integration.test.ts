import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseDatabase } from "@/lib/supabase/infrastructure/database";
import type { Database } from "@/types/supabase";
import {
  type AccountDeletionDbSchema,
  createSupabaseAccountDeletion,
} from "./supabase-account-deletion";
import { createSupabaseAuth } from "./supabase-auth";

// 外部SDKの応答の形が検証対象。実物のSupabaseのクライアントを通し、通信(fetch)だけを偽のサーバーで置く。
// 再認証で採用された新しいセッションのアクセストークンで削除が呼ばれることと、DBの拒否の応答の形(エラーのコードの位置)が、設計の写しになることを確かめる。

const SUPABASE_URL = "http://localhost:54321";

function base64Url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// SDKが復号できる形のJWT(署名は検証されない)。amrにパスワード認証の有無を持たせる。
function tokenOf(userId: string, methods: string[]) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    exp: now + 3600,
    iat: now,
    amr: methods.map((method) => ({ method, timestamp: now })),
  };
  return `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url(payload)}.c2lnbmF0dXJl`;
}

function sessionBody(userId: string, accessToken: string) {
  return {
    access_token: accessToken,
    refresh_token: "refresh-2",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email: "user@example.com", aud: "authenticated" },
  };
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function setup(handle: Handler) {
  const fetchStub = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handle(new URL(String(input)), init ?? {}),
  );
  const client = createClient<Database>(SUPABASE_URL, "anon-key", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchStub as typeof fetch },
  });
  const firstToken = tokenOf("user-1", ["otp"]);
  await client.auth.setSession({
    access_token: firstToken,
    refresh_token: "refresh-1",
  });
  const database = createSupabaseDatabase<AccountDeletionDbSchema>(
    () => client,
  );
  return {
    auth: createSupabaseAuth(() => client),
    account: createSupabaseAccountDeletion(database),
    fetchStub,
    firstToken,
  };
}

function authorizationOf(call: unknown[]) {
  const init = (call[1] ?? {}) as { headers?: HeadersInit };
  return new Headers(init.headers).get("Authorization");
}

describe("アカウント削除の認証とDBの接続", () => {
  it("再認証で採用された新しいセッションのアクセストークンで、delete_accountが呼ばれる", async () => {
    // Given
    const secondToken = tokenOf("user-1", ["password", "otp"]);
    const { auth, account, fetchStub, firstToken } = await setup((url) => {
      if (url.pathname === "/auth/v1/user") {
        return json({
          id: "user-1",
          email: "user@example.com",
          aud: "authenticated",
        });
      }
      if (url.pathname === "/auth/v1/token")
        return json(sessionBody("user-1", secondToken));
      return new Response(null, { status: 204 });
    });

    // When
    const reauthentication = await auth.reauthenticate({
      password: "password-current1",
      captchaToken: "captcha-token",
    });
    const deletion = await account.delete();

    // Then
    expect(reauthentication).toEqual({ kind: "verified", userId: "user-1" });
    expect(deletion).toEqual({ kind: "deleted" });
    const rpc = fetchStub.mock.calls.find(([url]) =>
      String(url).endsWith("/rest/v1/rpc/delete_account"),
    );
    expect(rpc).toBeDefined();
    expect(authorizationOf(rpc ?? [])).toBe(`Bearer ${secondToken}`);
    expect(authorizationOf(rpc ?? [])).not.toBe(`Bearer ${firstToken}`);
  });

  it("再認証で、メールアドレスとパスワードとチェックのトークンが、認証サービスへ届く", async () => {
    // Given
    const { auth, fetchStub } = await setup((url) => {
      if (url.pathname === "/auth/v1/user") {
        return json({
          id: "user-1",
          email: "user@example.com",
          aud: "authenticated",
        });
      }
      return json(sessionBody("user-1", tokenOf("user-1", ["password"])));
    });

    // When
    await auth.reauthenticate({
      password: "password-current1",
      captchaToken: "captcha-token",
    });

    // Then
    const tokenCall = fetchStub.mock.calls.find(([url]) =>
      String(url).includes("/auth/v1/token"),
    );
    const body = JSON.parse(String(((tokenCall ?? [])[1] as RequestInit).body));
    expect(body).toMatchObject({
      email: "user@example.com",
      password: "password-current1",
      gotrue_meta_security: { captcha_token: "captcha-token" },
    });
  });

  it("認証サービスのパスワード誤りの応答を、現在のパスワードの誤りとして返す", async () => {
    // Given
    const { auth } = await setup((url) => {
      if (url.pathname === "/auth/v1/user") {
        return json({
          id: "user-1",
          email: "user@example.com",
          aud: "authenticated",
        });
      }
      return json(
        {
          code: 400,
          error_code: "invalid_credentials",
          msg: "Invalid login credentials",
        },
        400,
      );
    });

    // When
    const result = await auth.reauthenticate({
      password: "wrong",
      captchaToken: "captcha-token",
    });

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "current_password_invalid" },
    });
  });

  it("再認証の前の確認が403(利用者が存在しない)の応答なら、サインインの喪失として返す", async () => {
    // Given
    let userDeleted = false;
    const { auth } = await setup(() => {
      if (userDeleted) {
        return json(
          {
            code: 403,
            error_code: "user_not_found",
            msg: "User from sub claim in JWT does not exist",
          },
          403,
        );
      }
      return json({
        id: "user-1",
        email: "user@example.com",
        aud: "authenticated",
      });
    });
    userDeleted = true;

    // When
    const result = await auth.reauthenticate({
      password: "password-current1",
      captchaToken: "captcha-token",
    });

    // Then
    expect(result).toEqual({ kind: "lost" });
  });

  it.each([
    [
      "PT403の拒否",
      json(
        {
          code: "PT403",
          message: "現在のパスワードによる再認証が必要です。",
          details: null,
          hint: null,
        },
        403,
      ),
      "other",
    ],
    [
      "PT403以外のコード付きの拒否",
      json(
        { code: "P0001", message: "試験用の失敗", details: null, hint: null },
        400,
      ),
      "other",
    ],
    [
      "制限時間(57014)の拒否",
      json(
        {
          code: "57014",
          message: "canceling statement due to statement timeout",
          details: null,
          hint: null,
        },
        500,
      ),
      "other",
    ],
  ])(
    "DBの%sの応答を、コードの位置を含めて、失敗の種類%sに写す",
    async (_name, response, kind) => {
      // Given
      const { account } = await setup((url) =>
        url.pathname === "/rest/v1/rpc/delete_account"
          ? response.clone()
          : json({}),
      );

      // When
      const result = await account.delete();

      // Then
      expect(result).toEqual({ kind: "failed", failure: { kind } });
    },
  );

  it.each([
    [
      "コードの無い応答(ゲートウェイの失敗)",
      () => new Response("<html>Bad Gateway</html>", { status: 502 }),
    ],
    [
      "通信の中断(fetchの例外)",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("%sは、結果不明(届かなかった失敗)に写す", async (_name, respond) => {
    // Given
    const { account } = await setup((url) =>
      url.pathname === "/rest/v1/rpc/delete_account" ? respond() : json({}),
    );

    // When
    const result = await account.delete();

    // Then
    expect(result).toEqual({
      kind: "failed",
      failure: { kind: "unreachable" },
    });
  });
});

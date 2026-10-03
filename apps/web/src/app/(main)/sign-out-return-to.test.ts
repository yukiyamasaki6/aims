import type { AuthError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 同一タブの明示サインアウトでは、SIGNED_OUTを受けた遷移に遷移元を付けないことを、
// サインアウト中に呼ばれるredirectToSignIn(SIGNED_OUTの遷移)の行き先で検証する。
// redirectToSignInは1回だけ遷移するモジュール状態を持つため、テストごとにモジュールを読み込み直す。
const supabase = vi.hoisted(() => {
  const listeners: Array<
    (event: string, session: { user: { id: string } } | null) => void
  > = [];
  return {
    listeners,
    signOut: vi.fn(),
    emit(event: string, session: { user: { id: string } } | null) {
      for (const listener of listeners) listener(event, session);
    },
  };
});
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      signOut: supabase.signOut,
      onAuthStateChange: (listener: (typeof supabase.listeners)[number]) => {
        supabase.listeners.push(listener);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

const replace = vi.fn();
let disposeLocalIdentity: () => void;

async function setup() {
  const { initLocalIdentity } = await import("@/features/auth/local-identity");
  const { createClient } = await import("@/lib/supabase/client");
  const { redirectToSignIn } = await import("@/features/auth/session-guard");
  const { signOut } = await import("./sign-out");
  disposeLocalIdentity = initLocalIdentity(createClient());
  supabase.emit("SIGNED_IN", { user: { id: "user-1" } });
  return { redirectToSignIn, signOut };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  supabase.listeners.length = 0;
  localStorage.clear();
  vi.stubGlobal("location", {
    replace,
    pathname: "/rounds/new",
    search: "",
  });
});

afterEach(() => {
  disposeLocalIdentity();
  vi.unstubAllGlobals();
});

describe("signOut とセッション喪失の遷移", () => {
  it("サインアウトが完了する場合、SIGNED_OUTを受けた遷移に遷移元を付けない", async () => {
    // Given: ローカルセッションの削除でSIGNED_OUTが発火し、その遷移が走る
    const { redirectToSignIn, signOut } = await setup();
    supabase.signOut.mockImplementation(async () => {
      supabase.emit("SIGNED_OUT", null);
      redirectToSignIn();
      return { error: null };
    });

    // When
    await signOut({ isMounted: () => true });

    // Then
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/signin");
  });

  it("サーバー通信が例外を投げてもローカルセッションが消えた場合、遷移元を付けない", async () => {
    // Given
    const { redirectToSignIn, signOut } = await setup();
    supabase.signOut.mockImplementation(async () => {
      supabase.emit("SIGNED_OUT", null);
      redirectToSignIn();
      throw new TypeError("Failed to fetch");
    });

    // When
    const result = await signOut({ isMounted: () => true });

    // Then
    expect(result).toEqual({ status: "signed-out" });
    expect(replace).toHaveBeenCalledWith("/signin");
  });

  it("サインアウトが失敗した後にセッションを喪失した場合、遷移元を付けて遷移する", async () => {
    // Given: ローカルセッションが残る失敗
    const { redirectToSignIn, signOut } = await setup();
    supabase.signOut.mockResolvedValue({
      error: { code: "over_request_rate_limit", message: "x" } as AuthError,
    });
    const result = await signOut({ isMounted: () => true });
    expect(result.status).toBe("failed");

    // When: その後に別の要因でセッション喪失の遷移が走る
    redirectToSignIn();

    // Then
    expect(replace).toHaveBeenCalledWith("/signin?returnTo=%2Frounds%2Fnew");
  });
});

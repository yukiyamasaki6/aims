import {
  AuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();

beforeEach(() => {
  vi.resetModules();
  replace.mockClear();
  vi.stubGlobal("location", { replace });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Listener = (event: string) => void;

function makeSupabase(getSession: () => Promise<unknown>) {
  const listeners: Listener[] = [];
  const unsubscribe = vi.fn();
  const client = {
    auth: {
      getSession: vi.fn(getSession),
      onAuthStateChange: (listener: Listener) => {
        listeners.push(listener);
        return { data: { subscription: { unsubscribe } } };
      },
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    getSession: client.auth.getSession,
    unsubscribe,
    emit(event: string) {
      for (const listener of listeners) listener(event);
    },
  };
}

const authenticated = async () => ({
  data: { session: { user: { id: "user-1" } } },
  error: null,
});
const unauthenticated = async () => ({ data: { session: null }, error: null });
const retryableFailure = async () => ({
  data: { session: null },
  error: new AuthRetryableFetchError("Failed to fetch", 0),
});

async function flushToMacrotask() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function load() {
  return await import("./session-guard");
}

describe("watchSessionLoss", () => {
  describe("認証状態の変化", () => {
    it("SIGNED_OUTを受けるとセッション喪失を通知する", async () => {
      // Given
      const { watchSessionLoss } = await load();
      const supabase = makeSupabase(authenticated);
      const onLost = vi.fn();
      watchSessionLoss(supabase.client, { onLost });

      // When
      supabase.emit("SIGNED_OUT");

      // Then
      expect(onLost).toHaveBeenCalledTimes(1);
    });

    it("オフラインでもSIGNED_OUTを受けると通知する", async () => {
      // Given
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { watchSessionLoss } = await load();
      const supabase = makeSupabase(authenticated);
      const onLost = vi.fn();
      watchSessionLoss(supabase.client, { onLost });

      // When
      supabase.emit("SIGNED_OUT");

      // Then
      expect(onLost).toHaveBeenCalledTimes(1);
    });

    it.each(["SIGNED_IN", "TOKEN_REFRESHED", "INITIAL_SESSION"])(
      "%sでは通知しない",
      async (event) => {
        // Given
        const { watchSessionLoss } = await load();
        const supabase = makeSupabase(authenticated);
        const onLost = vi.fn();
        watchSessionLoss(supabase.client, { onLost });

        // When
        supabase.emit(event);

        // Then
        expect(onLost).not.toHaveBeenCalled();
      },
    );
  });

  describe("マウント時の判定", () => {
    it("オンラインで未認証なら通知する", async () => {
      // Given
      const { watchSessionLoss } = await load();
      const supabase = makeSupabase(unauthenticated);
      const onLost = vi.fn();

      // When
      watchSessionLoss(supabase.client, { onLost });

      // Then
      await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1));
    });

    it("認証済みなら通知しない", async () => {
      // Given
      const { watchSessionLoss } = await load();
      const supabase = makeSupabase(authenticated);
      const onLost = vi.fn();

      // When
      watchSessionLoss(supabase.client, { onLost });

      // Then
      await vi.waitFor(() => expect(supabase.getSession).toHaveBeenCalled());
      await flushToMacrotask();
      expect(onLost).not.toHaveBeenCalled();
    });

    it("通信失敗（unknown）なら通知しない", async () => {
      // Given
      const { watchSessionLoss } = await load();
      const supabase = makeSupabase(retryableFailure);
      const onLost = vi.fn();

      // When
      watchSessionLoss(supabase.client, { onLost });

      // Then
      await vi.waitFor(() => expect(supabase.getSession).toHaveBeenCalled());
      await flushToMacrotask();
      expect(onLost).not.toHaveBeenCalled();
    });

    it("オフラインならgetSessionを呼ばず、onlineで再判定して通知する", async () => {
      // Given
      const onLine = vi.spyOn(navigator, "onLine", "get");
      onLine.mockReturnValue(false);
      const { watchSessionLoss } = await load();
      const supabase = makeSupabase(unauthenticated);
      const onLost = vi.fn();
      watchSessionLoss(supabase.client, { onLost });
      expect(supabase.getSession).not.toHaveBeenCalled();
      expect(onLost).not.toHaveBeenCalled();

      // When
      onLine.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));

      // Then
      await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1));
    });
  });

  describe("解除", () => {
    it("購読とonlineの監視を外し、遅れて返ったgetSessionでは通知しない", async () => {
      // Given
      const { watchSessionLoss } = await load();
      let resolveSession: (value: unknown) => void = () => {};
      const supabase = makeSupabase(
        () => new Promise((resolve) => (resolveSession = resolve)),
      );
      const onLost = vi.fn();
      const dispose = watchSessionLoss(supabase.client, { onLost });

      // When
      dispose();
      resolveSession(await unauthenticated());
      await flushToMacrotask();
      window.dispatchEvent(new Event("online"));

      // Then
      expect(supabase.unsubscribe).toHaveBeenCalledTimes(1);
      expect(supabase.getSession).toHaveBeenCalledTimes(1);
      expect(onLost).not.toHaveBeenCalled();
    });
  });
});

describe("redirectToSignIn", () => {
  function stubLocation(pathname: string, search = "") {
    vi.stubGlobal("location", { replace, pathname, search });
  }

  it("/rounds配下の画面では、現在のパスとクエリを遷移元として/signinへ置き換えで遷移する", async () => {
    // Given
    stubLocation("/rounds/new", "?a=1");
    const { redirectToSignIn } = await load();

    // When
    redirectToSignIn();

    // Then
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(
      "/signin?returnTo=%2Frounds%2Fnew%3Fa%3D1",
    );
  });

  it("/roundsでは、遷移元を付けずに/signinへ遷移する", async () => {
    // Given
    stubLocation("/rounds");
    const { redirectToSignIn } = await load();

    // When
    redirectToSignIn();

    // Then
    expect(replace).toHaveBeenCalledWith("/signin");
  });

  it("複数回呼んでも、遷移は1回である", async () => {
    // Given
    stubLocation("/rounds/new");
    const { redirectToSignIn } = await load();

    // When
    redirectToSignIn();
    redirectToSignIn();

    // Then
    expect(replace).toHaveBeenCalledTimes(1);
  });

  describe("同一タブの明示サインアウトの場合", () => {
    it("markExplicitSignOutの後は、遷移元を付けずに/signinへ遷移する", async () => {
      // Given
      stubLocation("/rounds/new", "?a=1");
      const { redirectToSignIn, markExplicitSignOut } = await load();
      markExplicitSignOut();

      // When
      redirectToSignIn();

      // Then
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith("/signin");
    });

    it("clearExplicitSignOutの後は、遷移元を付けて/signinへ遷移する", async () => {
      // Given
      stubLocation("/rounds/new");
      const { redirectToSignIn, markExplicitSignOut, clearExplicitSignOut } =
        await load();
      markExplicitSignOut();
      clearExplicitSignOut();

      // When
      redirectToSignIn();

      // Then
      expect(replace).toHaveBeenCalledWith("/signin?returnTo=%2Frounds%2Fnew");
    });
  });
});

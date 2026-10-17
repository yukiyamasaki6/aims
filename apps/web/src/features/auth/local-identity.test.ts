import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalIdentity, initLocalIdentity } from "./local-identity";

// SupabaseクライアントのonAuthStateChangeを模した最小限のスタブ。
// 実装側はこの形（auth.onAuthStateChangeにコールバックを登録できる）
// に依存する想定。
function createSupabaseStub() {
  const listeners: Array<(event: string, session: unknown) => void> = [];
  return {
    client: {
      auth: {
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          listeners.push(cb);
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      },
    },
    emit(event: string, session: unknown) {
      for (const cb of listeners) cb(event, session);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("local-identity", () => {
  it("初期状態ではローカルの識別ユーザーが無い", () => {
    // Given

    // When
    const identity = getLocalIdentity();

    // Then
    expect(identity).toBeNull();
  });

  it("SIGNED_INで端末ローカルの識別ユーザーを記録する", () => {
    // Given
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);

    // When
    stub.emit("SIGNED_IN", { user: { id: "user-1" } });

    // Then
    expect(getLocalIdentity()).toBe("user-1");
  });

  it("SIGNED_OUTで端末ローカルの識別ユーザーをクリアする", () => {
    // Given
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);
    stub.emit("SIGNED_IN", { user: { id: "user-1" } });
    expect(getLocalIdentity()).toBe("user-1");

    // When
    stub.emit("SIGNED_OUT", null);

    // Then
    expect(getLocalIdentity()).toBeNull();
  });

  it("SIGNED_IN/SIGNED_OUT以外のイベントでは記録を変更しない", () => {
    // Given
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);
    stub.emit("SIGNED_IN", { user: { id: "user-1" } });

    // When
    // トークンリフレッシュ等、他のイベントでは記録を書き換えない。
    // セッションのJWT鮮度に依存しない、という要件の核心部分。
    stub.emit("TOKEN_REFRESHED", { user: { id: "user-1" } });
    stub.emit("USER_UPDATED", { user: { id: "user-1" } });
    // 別ユーザーのSIGNED_INが来ない限り、無関係なイベントで
    // 前の識別ユーザーが消えたり書き換わったりしない。
    stub.emit("INITIAL_SESSION", null);

    // Then
    expect(getLocalIdentity()).toBe("user-1");
  });

  it("INITIAL_SESSIONにセッションがあれば端末ローカルの識別ユーザーを記録する（既存セッションの復元）", () => {
    // Given
    // ページ再読み込みで既存セッションが復元される場合、Supabaseは
    // SIGNED_INではなくINITIAL_SESSIONを発火する。これを無視すると、
    // 既にサインイン済みのユーザーの識別情報がいつまでも設定されない。
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);

    // When
    stub.emit("INITIAL_SESSION", { user: { id: "user-1" } });

    // Then
    expect(getLocalIdentity()).toBe("user-1");
  });

  it("INITIAL_SESSIONでセッションが無くても、既存の識別記録はクリアしない", () => {
    // Given
    // INITIAL_SESSIONでsessionが無いのは「未サインイン」とは限らず、
    // オフライン等でセッションを検証できなかった場合もあり得るため、
    // 既存の記録を消してはならない（SIGNED_OUTだけが唯一のクリア契機）。
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);
    stub.emit("SIGNED_IN", { user: { id: "user-1" } });

    // When
    stub.emit("INITIAL_SESSION", null);

    // Then
    expect(getLocalIdentity()).toBe("user-1");
  });

  it("記録はページ再読み込み後も永続化されている（ページをまたいだ再取得を模す）", () => {
    // Given
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);
    stub.emit("SIGNED_IN", { user: { id: "user-1" } });

    // When
    // 新規にモジュールを読み直したのと同じ状況を、getLocalIdentityの
    // 再呼び出し（内部状態ではなく永続化ストレージを見る）で模す。
    const identity = getLocalIdentity();

    // Then
    expect(identity).toBe("user-1");
  });

  it("initLocalIdentityが返す関数はunsubscribeを呼び出す", () => {
    // Given
    const unsubscribe = vi.fn();
    const client = {
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe } } }),
      },
    };
    const cleanup = initLocalIdentity(client as never);

    // When
    cleanup();

    // Then
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  describe("localStorageが使用できない場合（プライベートブラウジング等）", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("getLocalIdentityはエラーを投げずnullを返す", () => {
      // Given
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });

      // When
      const identity = getLocalIdentity();

      // Then
      expect(identity).toBeNull();
    });

    it("SIGNED_INでの記録失敗はエラーを投げず黙って無視する", () => {
      // Given
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const stub = createSupabaseStub();
      initLocalIdentity(stub.client as never);

      // When
      const signIn = () => stub.emit("SIGNED_IN", { user: { id: "user-1" } });

      // Then
      expect(signIn).not.toThrow();
    });
  });
});

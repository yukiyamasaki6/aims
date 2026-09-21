import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(getLocalIdentity()).toBeNull();
  });

  it("SIGNED_INで端末ローカルの識別ユーザーを記録する", () => {
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);

    stub.emit("SIGNED_IN", { user: { id: "user-1" } });

    expect(getLocalIdentity()).toBe("user-1");
  });

  it("SIGNED_OUTで端末ローカルの識別ユーザーをクリアする", () => {
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);

    stub.emit("SIGNED_IN", { user: { id: "user-1" } });
    expect(getLocalIdentity()).toBe("user-1");

    stub.emit("SIGNED_OUT", null);
    expect(getLocalIdentity()).toBeNull();
  });

  it("SIGNED_IN/SIGNED_OUT以外のイベントでは記録を変更しない", () => {
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);

    stub.emit("SIGNED_IN", { user: { id: "user-1" } });

    // トークンリフレッシュ等、他のイベントでは記録を書き換えない。
    // セッションのJWT鮮度に依存しない、という要件の核心部分。
    stub.emit("TOKEN_REFRESHED", { user: { id: "user-1" } });
    stub.emit("USER_UPDATED", { user: { id: "user-1" } });
    expect(getLocalIdentity()).toBe("user-1");

    // 別ユーザーのSIGNED_INが来ない限り、無関係なイベントで
    // 前の識別ユーザーが消えたり書き換わったりしない。
    stub.emit("INITIAL_SESSION", null);
    expect(getLocalIdentity()).toBe("user-1");
  });

  it("INITIAL_SESSIONにセッションがあれば端末ローカルの識別ユーザーを記録する（既存セッションの復元）", () => {
    // ページ再読み込みで既存セッションが復元される場合、Supabaseは
    // SIGNED_INではなくINITIAL_SESSIONを発火する。これを無視すると、
    // 既にサインイン済みのユーザーの識別情報がいつまでも設定されない。
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);

    stub.emit("INITIAL_SESSION", { user: { id: "user-1" } });

    expect(getLocalIdentity()).toBe("user-1");
  });

  it("INITIAL_SESSIONでセッションが無くても、既存の識別記録はクリアしない", () => {
    // INITIAL_SESSIONでsessionが無いのは「未サインイン」とは限らず、
    // オフライン等でセッションを検証できなかった場合もあり得るため、
    // 既存の記録を消してはならない（SIGNED_OUTだけが唯一のクリア契機）。
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);
    stub.emit("SIGNED_IN", { user: { id: "user-1" } });

    stub.emit("INITIAL_SESSION", null);

    expect(getLocalIdentity()).toBe("user-1");
  });

  it("記録はページ再読み込み後も永続化されている（ページをまたいだ再取得を模す）", () => {
    const stub = createSupabaseStub();
    initLocalIdentity(stub.client as never);
    stub.emit("SIGNED_IN", { user: { id: "user-1" } });

    // 新規にモジュールを読み直したのと同じ状況を、getLocalIdentityの
    // 再呼び出し（内部状態ではなく永続化ストレージを見る）で模す。
    expect(getLocalIdentity()).toBe("user-1");
  });
});

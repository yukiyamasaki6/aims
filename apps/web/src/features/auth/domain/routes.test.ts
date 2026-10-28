import { describe, expect, it } from "vitest";
import {
  allowedReturnTo,
  destinationOf,
  readReturnTo,
  redirectFor,
  signInHref,
} from "./routes";

describe("allowedReturnTo", () => {
  describe("/rounds配下の相対パスの場合", () => {
    it.each([
      ["/rounds", "/rounds"],
      ["/rounds/", "/rounds/"],
      ["/rounds/new", "/rounds/new"],
      [
        "/rounds/00000000-0000-0000-0000-000000000000?a=1",
        "/rounds/00000000-0000-0000-0000-000000000000?a=1",
      ],
      ["/rounds/new?x=1&y=%E3%81%82", "/rounds/new?x=1&y=%E3%81%82"],
    ])("%sを検証して%sを返す", (raw, expected) => {
      // Given

      // When
      const result = allowedReturnTo(raw);

      // Then
      expect(result).toBe(expected);
    });

    it("ハッシュを取り除いたパスとクエリを返す", () => {
      // Given

      // When
      const raw = "/rounds/new?a=1#section";
      const result = allowedReturnTo(raw);

      // Then
      expect(result).toBe("/rounds/new?a=1");
    });

    it("解析後に/rounds配下へ正規化されるドットセグメントは、正規化後の値を返す", () => {
      // Given

      // When
      const raw = "/rounds/x/../new";
      const result = allowedReturnTo(raw);

      // Then
      expect(result).toBe("/rounds/new");
    });
  });

  describe("拒否する値の場合", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["空文字", ""],
      ["スキームなしの外部ホスト(//)", "//evil.com"],
      ["スキームなしの外部ホスト(//rounds)", "//rounds/new"],
      ["スキーム付きの外部URL", "https://evil.com"],
      ["スキーム付きで/rounds配下に見えるURL", "https://evil.com/rounds/new"],
      ["javascriptスキーム", "javascript:alert(1)"],
      ["dataスキーム", "data:text/html,x"],
      ["/\\で始まる値", "/\\evil.com"],
      ["バックスラッシュを含む値", "/rounds\\..\\signin"],
      ["タブを挟んだ外部ホスト", "/\t/evil.com"],
      ["改行を挟んだ外部ホスト", "/\n/evil.com"],
      ["復帰文字を挟んだ外部ホスト", "/\r/evil.com"],
      ["パス中の改行", "/rounds/new\n"],
      ["NUL文字", "/rounds/\u0000new"],
      ["DEL文字", "/rounds/\u007fnew"],
      ["/で始まらない値", "rounds/new"],
      ["/signin", "/signin"],
      ["クエリ付きの/signin", "/signin?returnTo=%2Frounds"],
      ["/signup", "/signup"],
      ["/reset-password", "/reset-password"],
      ["ルート", "/"],
      ["/roundsで始まる別のパス", "/roundsx"],
      ["/rounds配下から/signinへ抜けるドットセグメント", "/rounds/../signin"],
      ["エンコードされたドットセグメント", "/rounds/%2e%2e/signin"],
      ["/roundsを装うクエリ", "/signin?next=/rounds"],
    ])("%sは拒否してnullを返す", (_name, raw) => {
      // Given

      // When
      const result = allowedReturnTo(raw);

      // Then
      expect(result).toBeNull();
    });

    it("長さが2048を超える値を拒否し、2048までは受け入れる", () => {
      // Given

      // When
      const atLimit = `/rounds/${"a".repeat(2048 - "/rounds/".length)}`;
      const overLimit = `${atLimit}a`;
      const accepted = allowedReturnTo(atLimit);
      const rejected = allowedReturnTo(overLimit);

      // Then
      expect(atLimit).toHaveLength(2048);
      expect(accepted).toBe(atLimit);
      expect(rejected).toBeNull();
    });
  });
});

describe("destinationOf", () => {
  it("許可された遷移元を返す", () => {
    // Given

    // When
    const result = destinationOf("/rounds/new?a=1");

    // Then
    expect(result).toBe("/rounds/new?a=1");
  });

  it("遷移元が無いか許可されない場合は一覧を返す", () => {
    // Given

    // When
    const missing = destinationOf(null);
    const external = destinationOf("https://evil.com/rounds");

    // Then
    expect(missing).toBe("/rounds");
    expect(external).toBe("/rounds");
  });
});

describe("signInHref", () => {
  it("/rounds配下の遷移元を、エンコードしたreturnTo付きの/signinにする", () => {
    // Given

    // When
    const from = "/rounds/new?x=1";
    const result = signInHref(from);

    // Then
    expect(result).toBe(`/signin?returnTo=${encodeURIComponent(from)}`);
    expect(result).toBe("/signin?returnTo=%2Frounds%2Fnew%3Fx%3D1");
  });

  it("ハッシュは含めずに返す", () => {
    // Given

    // When
    const from = "/rounds/new#top";
    const result = signInHref(from);

    // Then
    expect(result).toBe("/signin?returnTo=%2Frounds%2Fnew");
  });

  it.each([
    ["null", null],
    ["/rounds(既定の行き先と同じ)", "/rounds"],
    ["外部URL", "https://evil.com"],
    ["//で始まる値", "//evil.com"],
    ["/signin", "/signin"],
    ["/rounds/../signin", "/rounds/../signin"],
    ["空文字", ""],
  ])("%sはreturnTo無しの/signinにする", (_name, from) => {
    // Given

    // When
    const result = signInHref(from);

    // Then
    expect(result).toBe("/signin");
  });

  it("作ったreturnTo付きの/signinから、同じ遷移元を読み戻せる", () => {
    // Given

    // When
    const from = "/rounds/abc?a=1&b=%E3%81%82";
    const href = signInHref(from);
    const result = readReturnTo(href.slice(href.indexOf("?")));

    // Then
    expect(result).toBe(from);
  });
});

describe("readReturnTo", () => {
  it.each([
    ["?returnTo=%2Frounds%2Fnew", "/rounds/new"],
    ["returnTo=%2Frounds%2Fnew", "/rounds/new"],
    ["?a=1&returnTo=%2Frounds%2Fx%3Fb%3D2", "/rounds/x?b=2"],
  ])("%sから遷移元を読む", (search, expected) => {
    // Given

    // When
    const result = readReturnTo(search);

    // Then
    expect(result).toBe(expected);
  });

  it.each([
    ["空のクエリ", ""],
    ["returnToが無い", "?a=1"],
    ["returnToが空", "?returnTo="],
    ["外部URL", `?returnTo=${encodeURIComponent("https://evil.com")}`],
    ["//で始まる値", `?returnTo=${encodeURIComponent("//evil.com")}`],
    ["/signin", `?returnTo=${encodeURIComponent("/signin")}`],
    ["エンコードされた改行入りの値", "?returnTo=%2F%0A%2Fevil.com"],
  ])("%sの場合はnullを返す", (_name, search) => {
    // Given

    // When
    const result = readReturnTo(search);

    // Then
    expect(result).toBeNull();
  });
});

describe("redirectFor", () => {
  const request = {
    signedIn: false,
    pathname: "/",
    search: "",
    isServerAction: false,
  };

  it.each([
    [
      "未認証で/roundsを開くと、遷移元の無いサインイン",
      { pathname: "/rounds" },
      "/signin",
    ],
    [
      "未認証で/rounds配下を開くと、クエリ付きの遷移元つきのサインイン",
      { pathname: "/rounds/x", search: "?a=1" },
      "/signin?returnTo=%2Frounds%2Fx%3Fa%3D1",
    ],
    [
      "認証済みでサインインを開くと、有効な遷移元",
      {
        signedIn: true,
        pathname: "/signin",
        search: "?returnTo=%2Frounds%2Fx",
      },
      "/rounds/x",
    ],
    [
      "認証済みでサインインを遷移元なしで開くと、ラウンド一覧",
      { signedIn: true, pathname: "/signin" },
      "/rounds",
    ],
    [
      "認証済みでサインインを無効な遷移元で開くと、ラウンド一覧",
      { signedIn: true, pathname: "/signin", search: "?returnTo=%2Fsignup" },
      "/rounds",
    ],
    [
      "認証済みでサインアップを開くと、遷移元を使わずラウンド一覧",
      {
        signedIn: true,
        pathname: "/signup",
        search: "?returnTo=%2Frounds%2Fx",
      },
      "/rounds",
    ],
    [
      "認証済みでパスワード再設定を開くと、ラウンド一覧",
      { signedIn: true, pathname: "/reset-password" },
      "/rounds",
    ],
  ])("%s", (_name, override, expected) => {
    // Given

    // When
    const result = redirectFor({ ...request, ...override });

    // Then
    expect(result).toBe(expected);
  });

  it.each([
    ["未認証でサインインを開く", { pathname: "/signin" }],
    ["未認証でサインアップを開く", { pathname: "/signup" }],
    ["未認証でパスワード再設定を開く", { pathname: "/reset-password" }],
    ["未認証でトップを開く", { pathname: "/" }],
    ["未認証で/roundsで始まる別のパスを開く", { pathname: "/roundsx" }],
    ["認証済みで/roundsを開く", { signedIn: true, pathname: "/rounds" }],
    ["認証済みで/rounds配下を開く", { signedIn: true, pathname: "/rounds/1" }],
    ["認証済みでトップを開く", { signedIn: true, pathname: "/" }],
  ])("%sと、リダイレクトしない", (_name, override) => {
    // Given

    // When
    const result = redirectFor({ ...request, ...override });

    // Then
    expect(result).toBeNull();
  });

  it("Server Action呼び出しは、未認証でも認証済みでもリダイレクトしない", () => {
    // Given

    // When
    const signedOut = redirectFor({
      ...request,
      pathname: "/rounds/1",
      isServerAction: true,
    });
    const signedIn = redirectFor({
      ...request,
      signedIn: true,
      pathname: "/signin",
      isServerAction: true,
    });

    // Then
    expect(signedOut).toBeNull();
    expect(signedIn).toBeNull();
  });
});

// 経路の規則は、セッションの更新(lib/supabase/session)から引数で渡されるため、ここで要求ごとの行き先を確かめる。
describe("redirectFor: 要求ごとの行き先", () => {
  const request = {
    signedIn: false,
    pathname: "/",
    search: "",
    isServerAction: false,
  };

  it("未認証で/roundsにアクセスすると、遷移元を付けずに/signinへリダイレクトする", () => {
    // Given

    // When
    const result = redirectFor({ ...request, pathname: "/rounds" });

    // Then
    expect(result).toBe("/signin");
  });

  it.each([
    ["/rounds/new", "", "%2Frounds%2Fnew"],
    [
      "/rounds/00000000-0000-0000-0000-000000000000",
      "?a=1",
      "%2Frounds%2F00000000-0000-0000-0000-000000000000%3Fa%3D1",
    ],
  ])(
    "未認証で%s%sにアクセスすると、遷移元付きの/signinへリダイレクトする",
    (pathname, search, encoded) => {
      // Given

      // When
      const result = redirectFor({ ...request, pathname, search });

      // Then
      expect(result).toBe(`/signin?returnTo=${encoded}`);
    },
  );

  it.each(["/signin", "/signup", "/reset-password"])(
    "認証済みで%sにアクセスすると/roundsへリダイレクトする",
    (pathname) => {
      // Given

      // When
      const result = redirectFor({ ...request, signedIn: true, pathname });

      // Then
      expect(result).toBe("/rounds");
    },
  );

  it("認証済みで有効な遷移元付きの/signinにアクセスすると、遷移元へリダイレクトする", () => {
    // Given

    // When
    const result = redirectFor({
      ...request,
      signedIn: true,
      pathname: "/signin",
      search: "?returnTo=%2Frounds%2Fnew%3Fa%3D1",
    });

    // Then
    expect(result).toBe("/rounds/new?a=1");
  });

  it.each([
    ["外部URL", encodeURIComponent("https://evil.com")],
    ["//で始まる値", encodeURIComponent("//evil.com")],
    ["/signin", encodeURIComponent("/signin")],
    ["/rounds配下から抜けるドットセグメント", "%2Frounds%2F..%2Fsignin"],
  ])(
    "認証済みで不正な遷移元(%s)付きの/signinにアクセスすると、遷移元を引き継がず/roundsへリダイレクトする",
    (_name, returnTo) => {
      // Given

      // When
      const result = redirectFor({
        ...request,
        signedIn: true,
        pathname: "/signin",
        search: `?returnTo=${returnTo}`,
      });

      // Then
      expect(result).toBe("/rounds");
    },
  );

  it.each(["/signup", "/reset-password"])(
    "認証済みで有効な遷移元付きの%sにアクセスしても、遷移元を使わず/roundsへリダイレクトする",
    (pathname) => {
      // Given

      // When
      const result = redirectFor({
        ...request,
        signedIn: true,
        pathname,
        search: "?returnTo=%2Frounds%2Fnew",
      });

      // Then
      expect(result).toBe("/rounds");
    },
  );

  it("未認証で/rounds以外のパスはリダイレクトしない", () => {
    // Given

    // When
    const result = redirectFor({ ...request, pathname: "/offline" });

    // Then
    expect(result).toBeNull();
  });
});

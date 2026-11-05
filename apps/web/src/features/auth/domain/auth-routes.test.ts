import { describe, expect, it } from "vitest";
import {
  allowedReturnTo,
  destinationOf,
  redirectFor,
  signInHref,
} from "./auth-routes";

// 保護の範囲の根は使う側が渡す引数のため、既存の件は一覧の経路で確かめる。
const _ROUNDS = "/rounds";

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

  describe("拒否する値の場合(型・別オリジン・保護範囲の外)", () => {
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
      ["バックスラッシュで/rounds配下から抜ける値", "/rounds\\..\\signin"],
      ["タブを挟んだ外部ホスト", "/\t/evil.com"],
      ["改行を挟んだ外部ホスト", "/\n/evil.com"],
      ["復帰文字を挟んだ外部ホスト", "/\r/evil.com"],
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
  });

  describe("URLの正規化で保護パスになる値の場合", () => {
    it.each([
      ["パス末尾の改行", "/rounds/new\n", "/rounds/new"],
      ["NUL文字", "/rounds/\u0000new", "/rounds/%00new"],
      ["DEL文字", "/rounds/\u007fnew", "/rounds/%7Fnew"],
      ["バックスラッシュ", "/rounds\\new", "/rounds/new"],
      ["先頭の/が無い値", "rounds/new", "/rounds/new"],
    ])(
      "%sは、同一オリジンの保護パスなので、正規化後の値を返す",
      (_name, raw, expected) => {
        // Given

        // When
        const result = allowedReturnTo(raw);

        // Then
        expect(result).toBe(expected);
      },
    );

    it("長さが2048を超える値も、同一オリジンの保護パスなら受け入れる", () => {
      // Given

      // When
      const raw = `/rounds/${"a".repeat(3000)}`;
      const result = allowedReturnTo(raw);

      // Then
      expect(result).toBe(raw);
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

  it("遷移元がnullのときは、returnTo無しの/signinにする", () => {
    // Given

    // When
    const result = signInHref(null);

    // Then
    expect(result).toBe("/signin");
  });

  it("遷移元は、そのままエンコードしてreturnToに付ける", () => {
    // Given

    // When
    const result = signInHref("/rounds/x?a=1&b=2");

    // Then
    expect(result).toBe("/signin?returnTo=%2Frounds%2Fx%3Fa%3D1%26b%3D2");
  });
});

// 経路の規則は、proxyが、セッションの更新の結果の利用者から呼ぶため、ここで要求ごとの行き先を確かめる。
describe("redirectFor", () => {
  const request = {
    signedIn: false,
    pathname: "/",
    search: "",
  };

  it.each([
    [
      "未認証で/roundsを開くと、/roundsを遷移元に付けたサインイン",
      { pathname: "/rounds" },
      "/signin?returnTo=%2Frounds",
    ],
    [
      "未認証で/rounds配下を開くと、クエリ付きの遷移元つきのサインイン",
      { pathname: "/rounds/x", search: "?a=1" },
      "/signin?returnTo=%2Frounds%2Fx%3Fa%3D1",
    ],
    [
      "認証済みでサインインを開くと、ラウンド一覧",
      { signedIn: true, pathname: "/signin" },
      "/rounds",
    ],
    [
      "認証済みでサインインを遷移元付きで開いても、遷移元を使わずラウンド一覧",
      {
        signedIn: true,
        pathname: "/signin",
        search: "?returnTo=%2Frounds%2Fx",
      },
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
    ["未認証でトップを開く", { pathname: "/" }],
    ["未認証で/roundsで始まる別のパスを開く", { pathname: "/roundsx" }],
    ["認証済みで/rounds配下を開く", { signedIn: true, pathname: "/rounds/1" }],
    ["認証済みでトップを開く", { signedIn: true, pathname: "/" }],
  ])("%sと、リダイレクトしない", (_name, override) => {
    // Given

    // When
    const result = redirectFor({ ...request, ...override });

    // Then
    expect(result).toBeNull();
  });
});

// 保護の範囲の根は引数で渡る。実在する経路でない値で、規則が根に従うことを確かめる(値そのものが検証の対象)。

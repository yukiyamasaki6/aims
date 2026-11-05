import { describe, expect, it } from "vitest";
import {
  allowedReturnTo,
  destinationOf,
  readReturnTo,
  redirectFor,
  signInHref,
} from "./auth-routes";

// 保護の範囲の根は使う側が渡す引数のため、既存の件は一覧の経路で確かめる。
const ROUNDS = "/rounds";

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
      const result = allowedReturnTo(raw, ROUNDS);

      // Then
      expect(result).toBe(expected);
    });

    it("ハッシュを取り除いたパスとクエリを返す", () => {
      // Given

      // When
      const raw = "/rounds/new?a=1#section";
      const result = allowedReturnTo(raw, ROUNDS);

      // Then
      expect(result).toBe("/rounds/new?a=1");
    });

    it("解析後に/rounds配下へ正規化されるドットセグメントは、正規化後の値を返す", () => {
      // Given

      // When
      const raw = "/rounds/x/../new";
      const result = allowedReturnTo(raw, ROUNDS);

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
      const result = allowedReturnTo(raw, ROUNDS);

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
        const result = allowedReturnTo(raw, ROUNDS);

        // Then
        expect(result).toBe(expected);
      },
    );

    it("長さが2048を超える値も、同一オリジンの保護パスなら受け入れる", () => {
      // Given

      // When
      const raw = `/rounds/${"a".repeat(3000)}`;
      const result = allowedReturnTo(raw, ROUNDS);

      // Then
      expect(result).toBe(raw);
    });
  });
});

describe("destinationOf", () => {
  it("許可された遷移元を返す", () => {
    // Given

    // When
    const result = destinationOf("/rounds/new?a=1", ROUNDS);

    // Then
    expect(result).toBe("/rounds/new?a=1");
  });

  it("遷移元が無いか許可されない場合は一覧を返す", () => {
    // Given

    // When
    const missing = destinationOf(null, ROUNDS);
    const external = destinationOf("https://evil.com/rounds", ROUNDS);

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
    const result = signInHref(from, ROUNDS);

    // Then
    expect(result).toBe(`/signin?returnTo=${encodeURIComponent(from)}`);
    expect(result).toBe("/signin?returnTo=%2Frounds%2Fnew%3Fx%3D1");
  });

  it("ハッシュは含めずに返す", () => {
    // Given

    // When
    const from = "/rounds/new#top";
    const result = signInHref(from, ROUNDS);

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
    const result = signInHref(from, ROUNDS);

    // Then
    expect(result).toBe("/signin");
  });

  it("作ったreturnTo付きの/signinから、同じ遷移元を読み戻せる", () => {
    // Given

    // When
    const from = "/rounds/abc?a=1&b=%E3%81%82";
    const href = signInHref(from, ROUNDS);
    const result = readReturnTo(href.slice(href.indexOf("?")), ROUNDS);

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
    const result = readReturnTo(search, ROUNDS);

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
    const result = readReturnTo(search, ROUNDS);

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
    const result = redirectFor({ ...request, ...override }, ROUNDS);

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
    const result = redirectFor({ ...request, ...override }, ROUNDS);

    // Then
    expect(result).toBeNull();
  });

  it("Server Action呼び出しは、未認証でも認証済みでもリダイレクトしない", () => {
    // Given

    // When
    const signedOut = redirectFor(
      {
        ...request,
        pathname: "/rounds/1",
        isServerAction: true,
      },
      ROUNDS,
    );
    const signedIn = redirectFor(
      {
        ...request,
        signedIn: true,
        pathname: "/signin",
        isServerAction: true,
      },
      ROUNDS,
    );

    // Then
    expect(signedOut).toBeNull();
    expect(signedIn).toBeNull();
  });
});

// 経路の規則は、セッションの更新(lib/supabase/infrastructure/session)から引数で渡されるため、ここで要求ごとの行き先を確かめる。
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
    const result = redirectFor({ ...request, pathname: "/rounds" }, ROUNDS);

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
      const result = redirectFor({ ...request, pathname, search }, ROUNDS);

      // Then
      expect(result).toBe(`/signin?returnTo=${encoded}`);
    },
  );

  it.each(["/signin", "/signup", "/reset-password"])(
    "認証済みで%sにアクセスすると/roundsへリダイレクトする",
    (pathname) => {
      // Given

      // When
      const result = redirectFor(
        { ...request, signedIn: true, pathname },
        ROUNDS,
      );

      // Then
      expect(result).toBe("/rounds");
    },
  );

  it("認証済みで有効な遷移元付きの/signinにアクセスすると、遷移元へリダイレクトする", () => {
    // Given

    // When
    const result = redirectFor(
      {
        ...request,
        signedIn: true,
        pathname: "/signin",
        search: "?returnTo=%2Frounds%2Fnew%3Fa%3D1",
      },
      ROUNDS,
    );

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
      const result = redirectFor(
        {
          ...request,
          signedIn: true,
          pathname: "/signin",
          search: `?returnTo=${returnTo}`,
        },
        ROUNDS,
      );

      // Then
      expect(result).toBe("/rounds");
    },
  );

  it.each(["/signup", "/reset-password"])(
    "認証済みで有効な遷移元付きの%sにアクセスしても、遷移元を使わず/roundsへリダイレクトする",
    (pathname) => {
      // Given

      // When
      const result = redirectFor(
        {
          ...request,
          signedIn: true,
          pathname,
          search: "?returnTo=%2Frounds%2Fnew",
        },
        ROUNDS,
      );

      // Then
      expect(result).toBe("/rounds");
    },
  );

  it("未認証で/rounds以外のパスはリダイレクトしない", () => {
    // Given

    // When
    const result = redirectFor({ ...request, pathname: "/offline" }, ROUNDS);

    // Then
    expect(result).toBeNull();
  });
});

// 保護の範囲の根は引数で渡る。実在する経路でない値で、規則が根に従うことを確かめる(値そのものが検証の対象)。
describe("保護の範囲の根を差し替えたとき", () => {
  const Elsewhere = "/elsewhere";
  const request = {
    signedIn: false,
    pathname: "/",
    search: "",
    isServerAction: false,
  };

  it("根とその下だけを保護の範囲にし、/roundsと根で始まる別のパスは保護しない", () => {
    // Given

    // When
    const root = redirectFor({ ...request, pathname: "/elsewhere" }, Elsewhere);
    const below = redirectFor(
      { ...request, pathname: "/elsewhere/1" },
      Elsewhere,
    );
    const rounds = redirectFor({ ...request, pathname: "/rounds" }, Elsewhere);
    const prefixOnly = redirectFor(
      { ...request, pathname: "/elsewherex" },
      Elsewhere,
    );

    // Then
    expect(root).toBe("/signin");
    expect(below).toBe("/signin?returnTo=%2Felsewhere%2F1");
    expect(rounds).toBeNull();
    expect(prefixOnly).toBeNull();
  });

  it("遷移元に許すのは根とその下だけで、/rounds配下は拒否する", () => {
    // Given

    // When
    const below = allowedReturnTo("/elsewhere/1", Elsewhere);
    const rounds = allowedReturnTo("/rounds/1", Elsewhere);

    // Then
    expect(below).toBe("/elsewhere/1");
    expect(rounds).toBeNull();
  });

  it("既定の行き先は根で、無効な遷移元でも根になる", () => {
    // Given

    // When
    const missing = destinationOf(null, Elsewhere);
    const outside = destinationOf("/rounds/1", Elsewhere);

    // Then
    expect(missing).toBe("/elsewhere");
    expect(outside).toBe("/elsewhere");
  });

  it("認証済みで未認証専用の画面を開くと、根へ送る", () => {
    // Given

    // When
    const result = redirectFor(
      { ...request, signedIn: true, pathname: "/signin" },
      Elsewhere,
    );

    // Then
    expect(result).toBe("/elsewhere");
  });

  it("根の下の遷移元をreturnToに付けたサインインにし、/rounds配下の遷移元は付けない", () => {
    // Given

    // When
    const below = signInHref("/elsewhere/1", Elsewhere);
    const rounds = signInHref("/rounds/1", Elsewhere);

    // Then
    expect(below).toBe("/signin?returnTo=%2Felsewhere%2F1");
    expect(rounds).toBe("/signin");
  });
});

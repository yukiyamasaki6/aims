import { describe, expect, it } from "vitest";
import { readReturnTo, resolveReturnTo, signInHref } from "./return-to";

describe("resolveReturnTo", () => {
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
      const result = resolveReturnTo(raw);

      // Then
      expect(result).toBe(expected);
    });

    it("ハッシュを取り除いたパスとクエリを返す", () => {
      // Given
      const raw = "/rounds/new?a=1#section";

      // When
      const result = resolveReturnTo(raw);

      // Then
      expect(result).toBe("/rounds/new?a=1");
    });

    it("解析後に/rounds配下へ正規化されるドットセグメントは、正規化後の値を返す", () => {
      // Given
      const raw = "/rounds/x/../new";

      // When
      const result = resolveReturnTo(raw);

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
      const result = resolveReturnTo(raw);

      // Then
      expect(result).toBeNull();
    });

    it("長さが2048を超える値を拒否し、2048までは受け入れる", () => {
      // Given
      const atLimit = `/rounds/${"a".repeat(2048 - "/rounds/".length)}`;
      const overLimit = `${atLimit}a`;

      // When
      const accepted = resolveReturnTo(atLimit);
      const rejected = resolveReturnTo(overLimit);

      // Then
      expect(atLimit).toHaveLength(2048);
      expect(accepted).toBe(atLimit);
      expect(rejected).toBeNull();
    });
  });
});

describe("signInHref", () => {
  it("/rounds配下の遷移元を、エンコードしたreturnTo付きの/signinにする", () => {
    // Given
    const from = "/rounds/new?x=1";

    // When
    const result = signInHref(from);

    // Then
    expect(result).toBe(`/signin?returnTo=${encodeURIComponent(from)}`);
    expect(result).toBe("/signin?returnTo=%2Frounds%2Fnew%3Fx%3D1");
  });

  it("ハッシュは含めずに返す", () => {
    // Given
    // When
    const result = signInHref("/rounds/new#top");

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
    const from = "/rounds/abc?a=1&b=%E3%81%82";

    // When
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

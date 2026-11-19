import { describe, expect, it } from "vitest";
import {
  CHANGE_EMAIL_HASH,
  DELETE_ACCOUNT_HASH,
  SETTINGS_ACCOUNT_HASH,
} from "@/routes";
import {
  type SettingsView,
  settingsDepthOf,
  settingsHashOf,
  settingsHistoryStateOf,
  settingsLocationOf,
} from "./settings-location";

describe("settingsLocationOf", () => {
  it.each([
    ["#settings/account", "account"],
    ["#settings/account/email", "email"],
    ["#settings/account/delete-account", "delete-account"],
  ])("%sは、正規化せずに%sの表示で開く", (hash, view) => {
    // Given
    // When
    const result = settingsLocationOf(hash);

    // Then
    expect(result).toEqual({ view, normalize: false });
  });

  it.each([
    "#settings",
    "#settings/",
    "#settings/unknown",
    "#settings/account/",
    "#settings/account/email/x",
    "#settings/Account",
  ])("%sは、分類「アカウント」として開き、正規化が要る", (hash) => {
    // Given
    // When
    const result = settingsLocationOf(hash);

    // Then
    expect(result).toEqual({ view: "account", normalize: true });
  });

  it.each([
    ["#settingsfoo"],
    ["#settings-x"],
    [""],
    ["#"],
    ["#other"],
    ["#top"],
  ])("%sは、閉じていて、正規化は要らない", (hash) => {
    // Given
    // When
    const result = settingsLocationOf(hash);

    // Then
    expect(result).toEqual({ view: null, normalize: false });
  });
});

describe("settingsHashOf", () => {
  it.each([
    ["account", SETTINGS_ACCOUNT_HASH],
    ["email", CHANGE_EMAIL_HASH],
    ["delete-account", DELETE_ACCOUNT_HASH],
  ] as [SettingsView, string][])(
    "%sの表示のハッシュは、経路表の%sである",
    (view, hash) => {
      // Given
      // When
      const result = settingsHashOf(view);

      // Then
      expect(result).toBe(hash);
      expect(settingsLocationOf(result).view).toBe(view);
    },
  );
});

describe("settingsDepthOf", () => {
  const documentId = "doc-1";

  it.each([1, 2, 7])(
    "今の文書が積んだ段数%sの状態から、その段数を読む",
    (depth) => {
      // Given
      const state = { settingsDepth: depth, settingsDocumentId: documentId };

      // When
      const result = settingsDepthOf(state, documentId);

      // Then
      expect(result).toBe(depth);
    },
  );

  it.each([
    [
      "文書の識別子が違う(前の文書が積んだ)",
      {
        settingsDepth: 2,
        settingsDocumentId: "doc-0",
      },
    ],
    ["null", null],
    ["オブジェクトでない文字列", "state"],
    ["識別子が無い", { settingsDepth: 2 }],
    ["段数が0", { settingsDepth: 0, settingsDocumentId: documentId }],
    ["段数が負", { settingsDepth: -1, settingsDocumentId: documentId }],
    ["段数が小数", { settingsDepth: 1.5, settingsDocumentId: documentId }],
    ["段数が文字列", { settingsDepth: "2", settingsDocumentId: documentId }],
    ["段数が無い", { settingsDocumentId: documentId }],
  ])("%sの状態は、段数0として読む", (_name, state) => {
    // Given
    // When
    const result = settingsDepthOf(state, documentId);

    // Then
    expect(result).toBe(0);
  });
});

describe("settingsHistoryStateOf", () => {
  it("渡した段数と文書の識別子を持つ、読み戻せる状態を返す", () => {
    // Given
    // When
    const state = settingsHistoryStateOf(3, "doc-1");

    // Then
    expect(settingsDepthOf(state, "doc-1")).toBe(3);
  });

  it("Next.jsの内部の印を含まない状態を、呼ぶたびに新しく返す", () => {
    // Given
    // When
    const first = settingsHistoryStateOf(1, "doc-1");
    const second = settingsHistoryStateOf(1, "doc-1");

    // Then
    expect(Object.keys(first).sort()).toEqual([
      "settingsDepth",
      "settingsDocumentId",
    ]);
    expect(first).not.toBe(second);
  });
});

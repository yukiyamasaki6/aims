import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountSummary } from "../domain/account-summary";
import { createBrowserAccountSummaryStore } from "./browser-account-summary-store";

const STORAGE_KEY = "aims:account-summary";

const summary: AccountSummary = {
  userId: "user-1",
  email: "archer@example.test",
  google: { id: "google-1", email: "archer@gmail.test" },
};

function setup(identityUserId: string | null = "user-1") {
  return createBrowserAccountSummaryStore({ read: () => identityUserId });
}

afterEach(() => {
  window.localStorage.clear();
});

describe("概要の書き込みと読み出し", () => {
  it("書いた内容を読める", () => {
    // Given
    const store = setup();

    // When
    store.write(summary);

    // Then
    expect(store.read()).toEqual(summary);
  });

  it("記録が無いときは、nullを返す", () => {
    // Given
    const store = setup();

    // When
    const read = store.read();

    // Then
    expect(read).toBeNull();
  });

  it("記録の利用者が端末の識別情報の利用者と違うときは、nullを返す", () => {
    // Given
    setup("user-1").write(summary);
    const store = setup("user-2");

    // When
    const read = store.read();

    // Then
    expect(read).toBeNull();
  });

  it.each([
    ["JSONでない値", "{not json"],
    ["オブジェクトでない値", "42"],
    ["nullのJSON", "null"],
    ["利用者IDが文字列でない形", JSON.stringify({ userId: 1, email: "a" })],
  ])("%sは、例外にせずnullを返す", (_name, raw) => {
    // Given
    window.localStorage.setItem(STORAGE_KEY, raw);
    const store = setup();

    // When
    const read = store.read();

    // Then
    expect(read).toBeNull();
  });

  it("メールアドレスとGoogleの手段が読めない形のときは、それぞれnullにして読む", () => {
    // Given
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ userId: "user-1", email: 1, google: { id: 2 } }),
    );
    const store = setup();

    // When
    const read = store.read();

    // Then
    expect(read).toEqual({ userId: "user-1", email: null, google: null });
  });
});

describe("消去と購読", () => {
  it("消去すると、読み出しはnullを返す", () => {
    // Given
    const store = setup();
    store.write(summary);

    // When
    store.clear();

    // Then
    expect(store.read()).toBeNull();
  });

  it("書き込みと消去を、全ての実装の購読者へ知らせ、解除後は知らせない", () => {
    // Given
    const writer = setup();
    const other = setup();
    const listener = vi.fn();
    const stop = other.subscribe(listener);

    // When
    writer.write(summary);
    writer.clear();
    const callsBeforeStop = listener.mock.calls.length;
    stop();
    writer.write(summary);

    // Then
    expect(callsBeforeStop).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

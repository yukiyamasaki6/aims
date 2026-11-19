import { act, renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANGE_EMAIL_HASH,
  DELETE_ACCOUNT_HASH,
  SETTINGS_ACCOUNT_HASH,
  SETTINGS_HASH,
} from "@/routes";
import { useSettingsRoute } from "./use-settings-route";

// jsdomの実のhistoryとlocationを使う。開く前の画面は、印の付いた状態を持つ履歴の項目で表す。
const BASE_STATE = { base: true };

beforeEach(() => {
  window.history.replaceState(BASE_STATE, "", "/rounds");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup() {
  return renderHook(() => useSettingsRoute());
}

// 履歴の項目だけを足して、読み込み時に開いたパネルを作る(アドレス欄や再読み込みで直接開いた項目)。
// jsdomはハッシュの代入のhashchangeを後の回で届けるため、届くのを待ってから描画する。実のブラウザの読み込みでは、このイベントは起きない。
async function openedAtLoad(hash: string) {
  const changed = new Promise<void>((resolve) =>
    window.addEventListener("hashchange", () => resolve(), { once: true }),
  );
  window.location.hash = hash;
  await changed;
}

describe("useSettingsRoute", () => {
  describe("表示", () => {
    it("事前描画では、ハッシュが設定でも閉じている", async () => {
      // Given
      await openedAtLoad(SETTINGS_ACCOUNT_HASH);
      const Probe = () => String(useSettingsRoute().view);

      // When
      const html = renderToString(<Probe />);

      // Then
      expect(html).toBe("null");
    });

    it("マウントの後、ハッシュが設定を指していれば、その表示で開く", async () => {
      // Given
      await openedAtLoad(CHANGE_EMAIL_HASH);

      // When
      const { result } = setup();

      // Then
      expect(result.current.view).toBe("email");
    });

    it("ハッシュが設定を指していなければ、閉じている", async () => {
      // Given
      await openedAtLoad("#top");

      // When
      const { result } = setup();

      // Then
      expect(result.current.view).toBeNull();
    });
  });

  describe("開く・移る", () => {
    it("開くと、分類「アカウント」のハッシュで段数1の状態を積む", () => {
      // Given
      const { result } = setup();
      const { pathname, search } = window.location;
      const pushState = vi.spyOn(window.history, "pushState");

      // When
      act(() => result.current.open());

      // Then
      expect(result.current.view).toBe("account");
      expect(window.location.hash).toBe(SETTINGS_ACCOUNT_HASH);
      expect(window.location.pathname).toBe(pathname);
      expect(window.location.search).toBe(search);
      expect(pushState).toHaveBeenCalledTimes(1);
      expect(pushState).toHaveBeenCalledWith(
        expect.objectContaining({
          settingsDepth: 1,
          settingsDocumentId: expect.stringMatching(/\S/),
        }),
        "",
        `${pathname}${search}${SETTINGS_ACCOUNT_HASH}`,
      );
      expect(window.history.state).toEqual(pushState.mock.calls[0][0]);
      expect(window.history.state).toMatchObject({ settingsDepth: 1 });
    });

    it("移ると、段数を1足した状態を積み、その表示で開く", () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());

      // When
      act(() => result.current.move("delete-account"));

      // Then
      expect(result.current.view).toBe("delete-account");
      expect(window.location.hash).toBe(DELETE_ACCOUNT_HASH);
      expect(window.history.state).toMatchObject({ settingsDepth: 2 });
    });

    it("今と同じ表示への移る操作は、履歴を積まない", () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());
      const length = window.history.length;

      // When
      act(() => result.current.move("account"));

      // Then
      expect(window.history.length).toBe(length);
      expect(window.history.state).toMatchObject({ settingsDepth: 1 });
    });

    it("開いている間の開く操作は、履歴を積まない", () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());
      const length = window.history.length;

      // When
      act(() => result.current.open());

      // Then
      expect(window.history.length).toBe(length);
      expect(window.history.state).toMatchObject({ settingsDepth: 1 });
    });
  });

  describe("正規化", () => {
    it.each([SETTINGS_HASH, "#settings/unknown", "#settings/account/"])(
      "%sで開くと、履歴を増やさず、分類「アカウント」のハッシュへ置き換える",
      async (hash) => {
        // Given
        await openedAtLoad(hash);
        const length = window.history.length;

        // When
        const { result } = setup();

        // Then
        expect(result.current.view).toBe("account");
        expect(window.location.hash).toBe(SETTINGS_ACCOUNT_HASH);
        expect(window.history.length).toBe(length);
      },
    );

    it("設定でないハッシュ(#settingsfoo)は、履歴にもハッシュにも触れず、閉じている", async () => {
      // Given
      await openedAtLoad("#settingsfoo");
      const replaceState = vi.spyOn(window.history, "replaceState");

      // When
      const { result } = setup();

      // Then
      expect(result.current.view).toBeNull();
      expect(replaceState).not.toHaveBeenCalled();
      expect(window.location.hash).toBe("#settingsfoo");
    });
  });

  describe("閉じる", () => {
    it.each([
      [1, []],
      [3, ["email", "delete-account"]],
    ] as const)(
      "開く前の画面から開いて、段数%sで閉じると、段数だけ戻って開く前の画面へ戻る",
      async (_depth, moves) => {
        // Given
        const { result } = setup();
        act(() => result.current.open());
        for (const view of moves) act(() => result.current.move(view));

        // When
        act(() => result.current.close());
        await waitFor(() => expect(result.current.view).toBeNull());

        // Then
        expect(window.location.hash).toBe("");
        expect(window.history.state).toEqual(BASE_STATE);
      },
    );

    it("読み込み時に開いたパネルを閉じると、戻らずにハッシュだけを外す", async () => {
      // Given
      await openedAtLoad(SETTINGS_ACCOUNT_HASH);
      const { result } = setup();
      const length = window.history.length;
      const go = vi.spyOn(window.history, "go");

      // When
      act(() => result.current.close());

      // Then
      expect(result.current.view).toBeNull();
      expect(window.location.hash).toBe("");
      expect(window.history.length).toBe(length);
      expect(go).not.toHaveBeenCalled();
    });

    it("読み込み時に開き、中で2回移った後に閉じると、2つ戻り、起点のハッシュを外して閉じる", async () => {
      // Given
      await openedAtLoad(SETTINGS_ACCOUNT_HASH);
      const { result } = setup();
      act(() => result.current.move("email"));
      act(() => result.current.move("delete-account"));

      // When
      act(() => result.current.close());
      await waitFor(() => expect(result.current.view).toBeNull());

      // Then
      expect(window.location.hash).toBe("");
      expect(window.location.pathname).toBe("/rounds");
    });

    it("別の文書が積んだ履歴の項目は段数0として扱い、戻らずにハッシュを外す", async () => {
      // Given
      window.history.replaceState(
        { settingsDepth: 2, settingsDocumentId: "previous-document" },
        "",
        SETTINGS_ACCOUNT_HASH,
      );
      const { result } = setup();
      const go = vi.spyOn(window.history, "go");

      // When
      act(() => result.current.close());

      // Then
      expect(go).not.toHaveBeenCalled();
      expect(result.current.view).toBeNull();
      expect(window.location.hash).toBe("");
    });
  });

  describe("ブラウザの戻る・進む", () => {
    it("戻ると、前の表示へ戻る", async () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());
      act(() => result.current.move("email"));

      // When
      act(() => window.history.back());

      // Then
      await waitFor(() => expect(result.current.view).toBe("account"));
    });

    it("分類の表示からさらに戻ると、閉じる", async () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());
      act(() => result.current.move("email"));
      act(() => window.history.back());
      await waitFor(() => expect(result.current.view).toBe("account"));

      // When
      act(() => window.history.back());

      // Then
      await waitFor(() => expect(result.current.view).toBeNull());
    });

    it("閉じた後に進むと、開き直す", async () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());
      act(() => window.history.back());
      await waitFor(() => expect(result.current.view).toBeNull());

      // When
      act(() => window.history.forward());

      // Then
      await waitFor(() => expect(result.current.view).toBe("account"));
    });

    it("ハッシュを書き換えると、表示が追従する", async () => {
      // Given
      const { result } = setup();

      // When
      act(() => {
        window.location.hash = DELETE_ACCOUNT_HASH;
      });

      // Then
      await waitFor(() => expect(result.current.view).toBe("delete-account"));
    });

    it("ハッシュを外すと、閉じる", async () => {
      // Given
      const { result } = setup();
      act(() => {
        window.location.hash = DELETE_ACCOUNT_HASH;
      });
      await waitFor(() => expect(result.current.view).toBe("delete-account"));

      // When
      act(() => {
        window.location.hash = "";
      });

      // Then
      await waitFor(() => expect(result.current.view).toBeNull());
    });
  });

  describe("閉じたときのフォーカスの戻し先", () => {
    it("起点でハッシュを外して閉じると、背景の画面の先頭を指す", async () => {
      // Given
      await openedAtLoad(SETTINGS_ACCOUNT_HASH);
      const { result } = setup();

      // When
      act(() => result.current.close());

      // Then
      expect(result.current.closeFocus).toBe("content");
    });

    it("起点へ戻るだけの閉じ方では、開き口を指す", async () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());

      // When
      act(() => result.current.close());
      await waitFor(() => expect(result.current.view).toBeNull());

      // Then
      expect(result.current.closeFocus).toBe("opener");
    });

    it("ブラウザの戻るで閉じると、開き口を指す", async () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());

      // When
      act(() => window.history.back());
      await waitFor(() => expect(result.current.view).toBeNull());

      // Then
      expect(result.current.closeFocus).toBe("opener");
    });

    it("開いた直後は、開き口を指す", () => {
      // Given
      const { result } = setup();

      // When
      act(() => result.current.open());

      // Then
      expect(result.current.closeFocus).toBe("opener");
    });
  });

  describe("複数の利用と連続した操作", () => {
    it("2つの利用が購読している間、片方を外しても、もう片方はハッシュの変化に追従する", async () => {
      // Given
      const first = setup();
      const second = setup();
      first.unmount();

      // When
      act(() => {
        window.location.hash = DELETE_ACCOUNT_HASH;
      });

      // Then
      await waitFor(() =>
        expect(second.result.current.view).toBe("delete-account"),
      );
    });

    it("積んだ項目のハッシュが存在しない項目に書き換わると、段数を保ったまま分類「アカウント」へ置き換える", async () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());
      window.history.replaceState(
        window.history.state,
        "",
        "#settings/unknown",
      );

      // When
      act(() => {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });

      // Then
      await waitFor(() =>
        expect(window.location.hash).toBe(SETTINGS_ACCOUNT_HASH),
      );
      expect(window.history.state).toMatchObject({ settingsDepth: 1 });
    });

    it("閉じる操作の戻りが着く前にもう一度閉じても、戻りは1回だけである", async () => {
      // Given
      const { result } = setup();
      act(() => result.current.open());
      const go = vi.spyOn(window.history, "go");

      // When
      act(() => {
        result.current.close();
        result.current.close();
      });
      await waitFor(() => expect(result.current.view).toBeNull());

      // Then
      expect(go).toHaveBeenCalledTimes(1);
    });
  });
});

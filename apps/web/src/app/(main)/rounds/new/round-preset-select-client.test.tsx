import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import { type FetchedPresets, fetchPresets } from "./fetch-presets";
import type { Preset } from "./preset-types";
import { RoundPresetSelect } from "./round-preset-select-client";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

// SupabaseのSDKは外部サービスとの境界のため、セッション・プリセットの取得・RPC・削除の結果を任意に制御できるスタブで模す。
// 画面の操作は、実物のラウンド開始・プリセット削除の処理とSupabaseクライアントラッパーを通してこのスタブに届く。
const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  selectEq: vi.fn(),
  maybeSingle: vi.fn(),
  deleteEq: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getSession: supabase.getSession },
    rpc: supabase.rpc,
    from: () => ({
      select: () => ({ eq: supabase.selectEq }),
      delete: () => ({ eq: supabase.deleteEq }),
    }),
  }),
}));

// プリセットの取得は別のテストで確かめるため、取得関数を境界としてモックする。
vi.mock("./fetch-presets", () => ({ fetchPresets: vi.fn() }));
const fetchPresetsMock = vi.mocked(fetchPresets);

function fetchResolves(result: FetchResult<FetchedPresets>) {
  fetchPresetsMock.mockResolvedValue(result);
}

// 取得結果の一覧が出るまで待ってから返す。
async function renderSelect(personal: Preset[], global: Preset[]) {
  fetchResolves({ status: "ok", data: { personal, global } });
  const view = render(<RoundPresetSelect />);
  await waitFor(() => {
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  return view;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// 保留中の非同期処理を進めるため、マクロタスク1回分待つ。
function flushMacrotask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const personalPreset: Preset = {
  id: "preset-personal",
  name: "個人練習セット",
  format: "outdoor",
  bow_type: "recurve",
  preset_distances: [
    {
      id: "d2",
      position_key: "1-2",
      distance: 50,
      is_marked: true,
      total_ends: 6,
      arrows_per_end: 6,
      target_faces: null,
    },
    {
      id: "d1",
      position_key: "1-1",
      distance: 70,
      is_marked: true,
      total_ends: 6,
      arrows_per_end: 6,
      target_faces: null,
    },
  ],
};

const globalPreset: Preset = {
  id: "preset-global",
  name: "公式720ラウンド",
  format: "outdoor",
  bow_type: "recurve",
  preset_distances: [],
};

const otherPersonalPreset: Preset = {
  id: "preset-personal-2",
  name: "別の個人セット",
  format: "indoor",
  bow_type: "compound",
  preset_distances: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  supabase.rpc.mockResolvedValue({ data: "new-round-id", error: null });
  supabase.selectEq.mockReturnValue({ maybeSingle: supabase.maybeSingle });
  supabase.maybeSingle.mockResolvedValue({
    data: {
      format: "indoor",
      bow_type: "compound",
      preset_distances: [
        {
          id: "d1",
          position_key: "1-1",
          distance: 18,
          is_marked: true,
          total_ends: 10,
          arrows_per_end: 3,
          target_face_id: "face-1",
        },
      ],
    },
    error: null,
  });
  supabase.deleteEq.mockResolvedValue({ error: null });
});

describe("RoundPresetSelect", () => {
  describe("取得の状態", () => {
    it("取得中は読み込み中の表示と、枠と、押せる開始ボタンを表示し、プリセットの見出しは出さない", () => {
      // Given: 取得が完了しない
      fetchPresetsMock.mockReturnValue(new Promise(() => {}));

      // When
      render(<RoundPresetSelect />);

      // Then
      expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
      expect(
        screen.getByRole("link", { name: "一覧へ戻る" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      ).toHaveAttribute("aria-disabled", "false");
      expect(screen.queryByText("個人プリセット")).not.toBeInTheDocument();
    });

    it("取得が完了しない間も開始ボタンは押せ、押すとプリセット無しの既定値でラウンドを作成して遷移する", async () => {
      // Given: 取得が完了しない
      fetchPresetsMock.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      render(<RoundPresetSelect />);

      // When
      await user.click(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      );

      // Then
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
      });
      expect(supabase.selectEq).not.toHaveBeenCalled();
      expect(supabase.rpc).toHaveBeenCalledWith(
        "create_round",
        expect.objectContaining({
          p_format: "outdoor",
          p_bow_type: "recurve",
          p_distances: [],
        }),
      );
    });

    it("通信できない場合は未接続を表示し、プリセットの見出しは出さず、開始ボタンでラウンドを作成できる", async () => {
      // Given
      fetchResolves({ status: "offline" });
      const user = userEvent.setup();

      // When
      render(<RoundPresetSelect />);

      // Then
      expect(await screen.findByText("未接続")).toBeInTheDocument();
      expect(screen.queryByText("個人プリセット")).not.toBeInTheDocument();
      expect(screen.queryByText("公式プリセット")).not.toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      );
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
      });
    });

    it("取得がエラーの場合はエラーメッセージを表示し、開始ボタンでラウンドを作成できる", async () => {
      // Given
      fetchResolves({ status: "error", message: "読み込めませんでした。" });
      const user = userEvent.setup();

      // When
      render(<RoundPresetSelect />);

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );
      await user.click(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      );
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
      });
    });

    it("再試行すると取得し直し、取得できたプリセットを表示する", async () => {
      // Given: 1回目は通信できず、2回目は取得できる
      fetchPresetsMock
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({
          status: "ok",
          data: { personal: [], global: [globalPreset] },
        });
      const user = userEvent.setup();
      render(<RoundPresetSelect />);

      // When
      await user.click(await screen.findByRole("button", { name: "再試行" }));

      // Then
      expect(await screen.findByText("公式720ラウンド")).toBeInTheDocument();
      expect(screen.queryByText("未接続")).not.toBeInTheDocument();
      expect(fetchPresetsMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("プリセットの選択", () => {
    it("未選択では「プリセット無しで開始」を表示し、個人プリセットが無ければ案内文を出す", async () => {
      // Given/When: 個人プリセットが無い状態で表示する
      await renderSelect([], [globalPreset]);

      // Then: 開始ボタンは「プリセット無しで開始」で、個人プリセットの案内文を表示する
      expect(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("プリセットとして保存すると、ここに表示されます。"),
      ).toBeInTheDocument();
    });

    it("プリセットをクリックすると選択され、開始ボタンのラベルが変わる。再クリックで解除される", async () => {
      // Given: 個人プリセットと公式プリセットを表示している
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);

      // When: 個人プリセットをクリックする
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then: 開始ボタンのラベルが選択したプリセット名になる
      expect(
        screen.getByRole("button", { name: "「個人練習セット」で開始" }),
      ).toBeInTheDocument();

      // When: 同じプリセットを再クリックする
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then: 選択が解除され、開始ボタンは既定表示に戻る
      expect(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      ).toBeInTheDocument();
    });

    it("選択中に別のプリセットをクリックすると、そのプリセットへ選択が移る", async () => {
      // Given: 個人プリセットを選択している
      const user = userEvent.setup();
      await renderSelect([personalPreset, otherPersonalPreset], [globalPreset]);
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // When: 別の個人プリセットをクリックする
      await user.click(screen.getAllByTestId("round-preset-button")[1]);

      // Then: 開始ボタンのラベルがクリックしたプリセット名になり、元のプリセットの距離構成は閉じる
      expect(
        screen.getByRole("button", { name: "「別の個人セット」で開始" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("70m")).not.toBeInTheDocument();
    });

    it("公式プリセットも選択でき、開始ボタンのラベルが変わる", async () => {
      // Given: 個人プリセットと公式プリセットを表示している
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);

      // When: 公式プリセットをクリックする
      const buttons = screen.getAllByTestId("round-preset-button");
      await user.click(buttons[buttons.length - 1]);

      // Then: 開始ボタンのラベルが公式プリセット名になる
      expect(
        screen.getByRole("button", { name: "「公式720ラウンド」で開始" }),
      ).toBeInTheDocument();
    });
  });

  describe("プリセットのメニュー", () => {
    it("個人プリセットにだけメニューボタンを表示し、公式プリセットには表示しない", async () => {
      // Given/When: 個人プリセット1件と公式プリセット1件を表示する
      await renderSelect([personalPreset], [globalPreset]);

      // Then: メニューボタンは個人プリセットの1件分だけで、公式プリセットの行には無い
      const triggers = screen.getAllByTestId("round-preset-menu-trigger");
      expect(triggers).toHaveLength(1);
      const globalRow = screen.getByText("公式720ラウンド").closest("div");
      if (!globalRow) throw new Error("global preset row not found");
      expect(
        within(globalRow).queryByTestId("round-preset-menu-trigger"),
      ).not.toBeInTheDocument();
    });

    it("メニューを開いて外側をクリックすると、メニューが閉じる", async () => {
      // Given: 個人プリセットのメニューを開いている
      const user = userEvent.setup();
      await renderSelect([personalPreset], []);
      await user.click(screen.getByTestId("round-preset-menu-trigger"));
      expect(await screen.findByTestId("round-preset-delete")).toBeVisible();

      // When: メニューの外側をクリックする
      await user.click(document.body);

      // Then: メニューが閉じる
      await waitFor(() => {
        expect(
          screen.queryByTestId("round-preset-delete"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("選択中のプリセットの展開表示", () => {
    it("形式・弓種と、距離構成（距離・エンド構成）を展開表示する", async () => {
      // Given: 個人プリセットを表示している
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);

      // When: 個人プリセットをクリックする
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then: 形式・弓種と、各距離の距離とエンド構成を表示する
      expect(
        screen.getByTestId("round-preset-format-bow-type"),
      ).toHaveTextContent("アウトドア / リカーブ");
      expect(screen.getByText("70m")).toBeInTheDocument();
      expect(screen.getByText("50m")).toBeInTheDocument();
      expect(screen.getAllByText("6本×6エンド")).toHaveLength(2);
    });

    it("展開された距離構成の部分をクリックしても、選択が解除される", async () => {
      // Given: 個人プリセットを選択して、距離構成を展開している
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);
      await user.click(screen.getAllByTestId("round-preset-button")[0]);
      expect(screen.getByText("70m")).toBeInTheDocument();

      // When: 展開された距離構成の部分をクリックする
      await user.click(screen.getByText("70m"));

      // Then: 選択が解除され、距離構成が閉じ、開始ボタンは既定表示に戻る
      expect(screen.queryByText("70m")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      ).toBeInTheDocument();
    });
  });

  describe("開始ボタン", () => {
    describe("プリセット未選択で押した場合", () => {
      it("既定値でラウンドを作成し、作成したラウンドへ遷移する", async () => {
        // Given: プリセットを選択していない
        const user = userEvent.setup();
        await renderSelect([], []);

        // When: 開始ボタンを押す
        await user.click(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        );

        // Then: 既定値でcreate_roundを呼び、作成したラウンドへ遷移する
        await waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
        });
        expect(supabase.selectEq).not.toHaveBeenCalled();
        expect(supabase.rpc).toHaveBeenCalledWith(
          "create_round",
          expect.objectContaining({
            p_format: "outdoor",
            p_bow_type: "recurve",
            p_distances: [],
          }),
        );
      });
    });

    describe("プリセットを選択して押した場合", () => {
      it("選択中のプリセットを取得してその内容でラウンドを作成し、作成したラウンドへ遷移する", async () => {
        // Given: 個人プリセットを選択している
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);

        // When: 開始ボタンを押す
        await user.click(
          screen.getByRole("button", { name: "「個人練習セット」で開始" }),
        );

        // Then: 選択中のプリセットを取得し、その内容でcreate_roundを呼んで遷移する
        await waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
        });
        expect(supabase.selectEq).toHaveBeenCalledWith("id", "preset-personal");
        expect(supabase.rpc).toHaveBeenCalledWith(
          "create_round",
          expect.objectContaining({
            p_format: "indoor",
            p_bow_type: "compound",
            p_distances: [
              expect.objectContaining({
                position_key: "1-1",
                target_face_id: "face-1",
              }),
            ],
          }),
        );
      });
    });

    describe("送信中に再度押した場合", () => {
      it("ラウンドを1回だけ作成し、遷移後も押せない表示のままにする", async () => {
        // Given: create_roundの完了を保留にする
        const deferred = createDeferred<{
          data: string | null;
          error: { message: string } | null;
        }>();
        supabase.rpc.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        await renderSelect([], []);
        const button = screen.getByRole("button", {
          name: "プリセット無しで開始",
        });

        // When: 送信中に開始ボタンを再度押し、その後create_roundが成功する
        await user.click(button);
        await waitFor(() => {
          expect(supabase.rpc).toHaveBeenCalled();
        });
        await user.click(button);
        deferred.resolve({ data: "new-round-id", error: null });

        // Then: create_roundは1回だけ呼ばれ、遷移後も開始ボタンは押せない表示のまま
        await waitFor(() => {
          expect(nav.push).toHaveBeenCalledTimes(1);
        });
        expect(supabase.rpc).toHaveBeenCalledTimes(1);
        expect(button).toHaveAttribute("aria-disabled", "true");
      });
    });

    describe("作成に失敗した場合", () => {
      it("エラーを表示して遷移せず、開始ボタンを再度押せる表示に戻す", async () => {
        // Given: create_roundがエラーを返す
        supabase.rpc.mockResolvedValue({
          data: null,
          error: { message: "権限がありません。" },
        });
        const user = userEvent.setup();
        await renderSelect([], []);

        // When: 開始ボタンを押す
        await user.click(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        );

        // Then: エラーを表示し、遷移せず、開始ボタンを再度押せる表示に戻す
        expect(
          await screen.findByText("権限がありません。"),
        ).toBeInTheDocument();
        expect(nav.push).not.toHaveBeenCalled();
        expect(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        ).toHaveAttribute("aria-disabled", "false");
      });
    });

    describe("作成の完了を待つ間にアンマウントされた場合", () => {
      it("作成できても遷移しない", async () => {
        // Given: create_roundの完了を保留にして開始ボタンを押している
        const deferred = createDeferred<{
          data: string | null;
          error: { message: string } | null;
        }>();
        supabase.rpc.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        const { unmount } = await renderSelect([], []);
        await user.click(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        );
        await waitFor(() => {
          expect(supabase.rpc).toHaveBeenCalled();
        });

        // When: アンマウントした後にcreate_roundが成功する
        unmount();
        deferred.resolve({ data: "new-round-id", error: null });
        await flushMacrotask();

        // Then: 遷移しない
        expect(nav.push).not.toHaveBeenCalled();
      });
    });
  });

  describe("個人プリセットの削除", () => {
    async function openDeleteDialog(
      user: ReturnType<typeof userEvent.setup>,
      presetName: string,
    ) {
      const row = screen.getByText(presetName).closest("div");
      if (!row) throw new Error(`preset row not found: ${presetName}`);
      await user.click(within(row).getByTestId("round-preset-menu-trigger"));
      await user.click(await screen.findByTestId("round-preset-delete"));
    }

    describe("削除を確定した場合", () => {
      it("選択中のプリセットを削除すると、一覧から取り除き選択を解除する", async () => {
        // Given: 個人プリセットを選択している
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);

        // When: 選択中のプリセットの削除を確定する
        await openDeleteDialog(user, "個人練習セット");
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then: そのプリセットを削除して一覧から取り除き、開始ボタンは既定表示に戻る
        await waitFor(() => {
          expect(screen.queryByText("個人練習セット")).not.toBeInTheDocument();
        });
        expect(supabase.deleteEq).toHaveBeenCalledWith("id", "preset-personal");
        expect(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        ).toBeInTheDocument();
      });

      it("選択中とは別のプリセットを削除すると、一覧から取り除き選択は維持する", async () => {
        // Given: 2つの個人プリセットのうち「個人練習セット」を選択している
        const user = userEvent.setup();
        await renderSelect([personalPreset, otherPersonalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);

        // When: 選択していない「別の個人セット」の削除を確定する
        await openDeleteDialog(user, "別の個人セット");
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then: 「別の個人セット」を一覧から取り除き、選択は維持する
        await waitFor(() => {
          expect(screen.queryByText("別の個人セット")).not.toBeInTheDocument();
        });
        expect(
          screen.getByRole("button", { name: "「個人練習セット」で開始" }),
        ).toBeInTheDocument();
      });
    });

    describe("削除に失敗した場合", () => {
      it("エラーを表示し、一覧から取り除かない", async () => {
        // Given: 削除がエラーを返す
        supabase.deleteEq.mockResolvedValue({
          error: { message: "権限がありません。" },
        });
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);

        // When: 削除を確定する
        await openDeleteDialog(user, "個人練習セット");
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then: エラーを表示し、プリセットは一覧に残る
        expect(
          await screen.findByText("権限がありません。"),
        ).toBeInTheDocument();
        expect(screen.getByText("個人練習セット")).toBeInTheDocument();
      });

      it("削除確認ダイアログは開いたままで、確認ボタンを再度押せる", async () => {
        // Given: 削除がエラーを返す
        supabase.deleteEq.mockResolvedValue({
          error: { message: "権限がありません。" },
        });
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);

        // When: 削除を確定する
        await openDeleteDialog(user, "個人練習セット");
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then: エラーを表示したままダイアログが開いており、確認ボタンが再度有効になる
        expect(
          await screen.findByText("権限がありません。"),
        ).toBeInTheDocument();
        expect(screen.getByTestId("confirm-dialog-confirm")).toBeEnabled();
        expect(
          screen.getByTestId("confirm-dialog-confirm"),
        ).not.toHaveAttribute("aria-disabled", "true");
      });
    });
  });
});

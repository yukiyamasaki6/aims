import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import { createClient } from "@/lib/supabase/client";
import {
  deletePresetFromSnapshot,
  type FetchedPresets,
  fetchPresets,
} from "../_shared/fetch-presets";
import type { Preset } from "../_shared/preset-types";
import { RoundPresetSelect } from "./round-preset-select-client";
import { startRound } from "./start-round";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

// SupabaseのSDKは外部サービスとの境界のため、セッションとプリセット削除の結果を任意に制御できるスタブで模す。
// プリセット削除の処理は、実物の処理とSupabaseクライアントラッパーを通してこのスタブに届く。
const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  deleteEq: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getSession: supabase.getSession },
    from: () => ({
      delete: () => ({ eq: supabase.deleteEq }),
    }),
  }),
}));

const sessionReader = createSupabaseAuth(createClient);
const identityReader = createBrowserIdentityStore();

// ラウンドの開始(作成の操作の列への追記)は別のテストで確かめるため、開始関数を境界としてモックする。
vi.mock("./start-round", () => ({ startRound: vi.fn() }));
const startRoundMock = vi.mocked(startRound);

// プリセットの取得は別のテストで確かめるため、取得関数を境界としてモックする。
vi.mock("../_shared/fetch-presets", () => ({
  fetchPresets: vi.fn(),
  deletePresetFromSnapshot: vi.fn(),
}));
const fetchPresetsMock = vi.mocked(fetchPresets);

function fetchResolves(result: FetchResult<FetchedPresets>) {
  fetchPresetsMock.mockResolvedValue(result);
}

// 取得結果の一覧が出るまで待ってから返す。
async function renderSelect(personal: Preset[], global: Preset[]) {
  fetchResolves({ status: "ok", data: { personal, global } });
  const view = render(
    <RoundPresetSelect
      sessionReader={sessionReader}
      identityReader={identityReader}
    />,
  );
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
      target_face_id: "face-1",
      target_faces: null,
    },
    {
      id: "d1",
      position_key: "1-1",
      distance: 70,
      is_marked: true,
      total_ends: 6,
      arrows_per_end: 6,
      target_face_id: "face-1",
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
  // offlineの結果が返る状況はnavigator.onLineがfalseである(trueのままだと、すぐ再取得する)。
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  startRoundMock.mockResolvedValue({
    status: "created",
    roundId: "new-round-id",
  });
  supabase.deleteEq.mockResolvedValue({ error: null });
});

describe("RoundPresetSelect", () => {
  describe("取得の状態", () => {
    it("取得中は読み込み中の表示と、枠と、押せる開始ボタンを表示し、プリセットの見出しは出さない", () => {
      // Given
      fetchPresetsMock.mockReturnValue(new Promise(() => {}));

      // When
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

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

    it("取得が完了しない間も開始ボタンは押せ、押すとプリセット未選択で開始して遷移する", async () => {
      // Given
      fetchPresetsMock.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // When
      await user.click(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      );

      // Then
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
      });
      expect(startRoundMock).toHaveBeenCalledWith(
        expect.objectContaining({ preset: null }),
      );
    });

    it("通信できない場合はネットワークに接続されていませんを表示し、プリセットの見出しは出さない", async () => {
      // Given
      fetchResolves({ status: "offline" });

      // When
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      expect(
        await screen.findByText("ネットワークに接続されていません"),
      ).toBeInTheDocument();
      expect(screen.queryByText("個人プリセット")).not.toBeInTheDocument();
      expect(screen.queryByText("公式プリセット")).not.toBeInTheDocument();
    });

    it("通信できない場合も、開始ボタンを押すとラウンドを作成して遷移する", async () => {
      // Given
      fetchResolves({ status: "offline" });
      const user = userEvent.setup();
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByText("ネットワークに接続されていません");

      // When
      await user.click(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      );

      // Then
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
      });
    });

    it("取得がエラーの場合はエラーメッセージを表示する", async () => {
      // Given
      fetchResolves({ status: "error", message: "読み込めませんでした。" });

      // When
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "読み込めませんでした。",
      );
    });

    it("取得がエラーの場合も、開始ボタンを押すとラウンドを作成して遷移する", async () => {
      // Given
      fetchResolves({ status: "error", message: "読み込めませんでした。" });
      const user = userEvent.setup();
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await screen.findByRole("alert");

      // When
      await user.click(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      );

      // Then
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
      });
    });

    it("再試行すると取得し直し、取得できたプリセットを表示する", async () => {
      // Given
      fetchPresetsMock
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({
          status: "ok",
          data: { personal: [], global: [globalPreset] },
        });
      const user = userEvent.setup();
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );

      // When
      await user.click(await screen.findByRole("button", { name: "再試行" }));

      // Then
      expect(await screen.findByText("公式720ラウンド")).toBeInTheDocument();
      expect(
        screen.queryByText("ネットワークに接続されていません"),
      ).not.toBeInTheDocument();
      expect(fetchPresetsMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("プリセットの選択", () => {
    it("取得したプリセットを表示した直後は未選択で、開始ボタンに「プリセット無しで開始」を表示する", async () => {
      // Given
      fetchResolves({
        status: "ok",
        data: { personal: [], global: [globalPreset] },
      });

      // When
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });

      // Then
      expect(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      ).toBeInTheDocument();
    });

    it("個人プリセットが無ければ、個人プリセット欄に案内文を表示する", async () => {
      // Given
      fetchResolves({
        status: "ok",
        data: { personal: [], global: [globalPreset] },
      });

      // When
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });

      // Then
      expect(
        screen.getByText("プリセットとして保存すると、ここに表示されます。"),
      ).toBeInTheDocument();
    });

    it("プリセットをクリックすると選択され、開始ボタンのラベルが選択したプリセット名になる", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then
      expect(
        screen.getByRole("button", { name: "「個人練習セット」で開始" }),
      ).toBeInTheDocument();
    });

    it("選択中のプリセットを再クリックすると選択が解除され、開始ボタンは「プリセット無しで開始」に戻る", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);
      await user.click(screen.getAllByTestId("round-preset-button")[0]);
      expect(
        screen.getByRole("button", { name: "「個人練習セット」で開始" }),
      ).toBeInTheDocument();

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then
      expect(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      ).toBeInTheDocument();
    });

    it("選択中に別のプリセットをクリックすると、そのプリセットへ選択が移る", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset, otherPersonalPreset], [globalPreset]);
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[1]);

      // Then
      expect(
        screen.getByRole("button", { name: "「別の個人セット」で開始" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("70m")).not.toBeInTheDocument();
    });

    it("公式プリセットも選択でき、開始ボタンのラベルが変わる", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);

      // When
      const buttons = screen.getAllByTestId("round-preset-button");
      await user.click(buttons[buttons.length - 1]);

      // Then
      expect(
        screen.getByRole("button", { name: "「公式720ラウンド」で開始" }),
      ).toBeInTheDocument();
    });
  });

  describe("プリセットのメニュー", () => {
    it("個人プリセットにだけメニューボタンを表示し、公式プリセットには表示しない", async () => {
      // Given
      fetchResolves({
        status: "ok",
        data: { personal: [personalPreset], global: [globalPreset] },
      });

      // When
      render(
        <RoundPresetSelect
          sessionReader={sessionReader}
          identityReader={identityReader}
        />,
      );
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });

      // Then
      const triggers = screen.getAllByTestId("round-preset-menu-trigger");
      expect(triggers).toHaveLength(1);
      const globalRow = screen.getByText("公式720ラウンド").closest("div");
      if (!globalRow) throw new Error("global preset row not found");
      expect(
        within(globalRow).queryByTestId("round-preset-menu-trigger"),
      ).not.toBeInTheDocument();
    });
  });

  describe("選択中のプリセットの展開表示", () => {
    it("形式・弓種と、距離構成（距離・エンド構成）を展開表示する", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then
      expect(
        screen.getByTestId("round-preset-format-bow-type"),
      ).toHaveTextContent("アウトドア / リカーブ");
      expect(screen.getByText("70m")).toBeInTheDocument();
      expect(screen.getByText("50m")).toBeInTheDocument();
      expect(screen.getAllByText("6本×6エンド")).toHaveLength(2);
    });

    it("プリセットに的が埋め込まれていない距離は「的データを取得できません」と表示する", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], []);

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then
      expect(screen.getAllByText("的データを取得できません")).toHaveLength(2);
    });

    it("展開された距離構成の部分をクリックしても、選択が解除される", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);
      await user.click(screen.getAllByTestId("round-preset-button")[0]);
      expect(screen.getByText("70m")).toBeInTheDocument();

      // When
      await user.click(screen.getByText("70m"));

      // Then
      expect(screen.queryByText("70m")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "プリセット無しで開始" }),
      ).toBeInTheDocument();
    });
  });

  describe("開始ボタン", () => {
    describe("プリセット未選択で押した場合", () => {
      it("プリセット無しで開始し、作成したラウンドへ遷移する", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([], []);

        // When
        await user.click(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        );

        // Then
        await waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
        });
        expect(startRoundMock).toHaveBeenCalledWith(
          expect.objectContaining({ preset: null }),
        );
      });
    });

    describe("プリセットを選択して押した場合", () => {
      it("一覧の取得結果の選択中のプリセットで開始し、作成したラウンドへ遷移する", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);

        // When
        await user.click(
          screen.getByRole("button", { name: "「個人練習セット」で開始" }),
        );

        // Then
        await waitFor(() => {
          expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
        });
        expect(startRoundMock).toHaveBeenCalledWith(
          expect.objectContaining({ preset: personalPreset }),
        );
      });

      it("開始へ、マウント状態の判定と、ID生成、現在時刻の取得を渡す", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);

        // When
        await user.click(
          screen.getByRole("button", { name: "「個人練習セット」で開始" }),
        );

        // Then
        await waitFor(() => expect(startRoundMock).toHaveBeenCalled());
        const args = startRoundMock.mock.calls[0][0];
        expect(args.isMounted()).toBe(true);
        expect(args.generateId()).toMatch(/^[0-9a-f-]{36}$/);
        expect(args.now()).toBeInstanceOf(Date);
      });
    });

    describe("送信中に再度押した場合", () => {
      it("開始中に開始ボタンを再度押しても、開始を1回だけ行う", async () => {
        // Given
        const deferred = createDeferred<{
          status: "created";
          roundId: string;
        }>();
        startRoundMock.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        await renderSelect([], []);
        const button = screen.getByRole("button", {
          name: "プリセット無しで開始",
        });
        await user.click(button);
        await waitFor(() => {
          expect(startRoundMock).toHaveBeenCalled();
        });

        // When
        await user.click(button);

        // Then
        expect(startRoundMock).toHaveBeenCalledTimes(1);
      });

      it("開始が完了して遷移した後も、開始ボタンを押せない表示のままにする", async () => {
        // Given
        const deferred = createDeferred<{
          status: "created";
          roundId: string;
        }>();
        startRoundMock.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        await renderSelect([], []);
        const button = screen.getByRole("button", {
          name: "プリセット無しで開始",
        });
        await user.click(button);
        await waitFor(() => {
          expect(startRoundMock).toHaveBeenCalled();
        });
        await user.click(button);

        // When
        deferred.resolve({ status: "created", roundId: "new-round-id" });

        // Then
        await waitFor(() => {
          expect(nav.push).toHaveBeenCalledTimes(1);
        });
        expect(button).toHaveAttribute("aria-disabled", "true");
      });
    });

    describe("開始できなかった場合", () => {
      it("エラーを表示して遷移せず、開始ボタンを再度押せる表示に戻す", async () => {
        // Given
        startRoundMock.mockResolvedValue({
          status: "failed",
          error: "権限がありません。",
        });
        const user = userEvent.setup();
        await renderSelect([], []);

        // When
        await user.click(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        );

        // Then
        expect(
          await screen.findByText("権限がありません。"),
        ).toBeInTheDocument();
        expect(nav.push).not.toHaveBeenCalled();
        expect(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        ).toHaveAttribute("aria-disabled", "false");
      });
    });

    describe("開始の完了を待つ間にアンマウントされた場合", () => {
      it("開始できても遷移しない", async () => {
        // Given
        const deferred = createDeferred<void>();
        startRoundMock.mockImplementation(async ({ isMounted }) => {
          await deferred.promise;
          return isMounted()
            ? { status: "created", roundId: "new-round-id" }
            : { status: "discarded" };
        });
        const user = userEvent.setup();
        const { unmount } = await renderSelect([], []);
        await user.click(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        );
        await waitFor(() => {
          expect(startRoundMock).toHaveBeenCalled();
        });
        unmount();

        // When
        deferred.resolve();
        await flushMacrotask();

        // Then
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
        // Given
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);
        await openDeleteDialog(user, "個人練習セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
        await waitFor(() => {
          expect(screen.queryByText("個人練習セット")).not.toBeInTheDocument();
        });
        expect(supabase.deleteEq).toHaveBeenCalledWith("id", "preset-personal");
        expect(deletePresetFromSnapshot).toHaveBeenCalledWith(
          identityReader,
          "preset-personal",
        );
        expect(
          screen.getByRole("button", { name: "プリセット無しで開始" }),
        ).toBeInTheDocument();
      });

      it("選択中とは別のプリセットを削除すると、一覧から取り除き選択は維持する", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([personalPreset, otherPersonalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);
        await openDeleteDialog(user, "別の個人セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
        await waitFor(() => {
          expect(screen.queryByText("別の個人セット")).not.toBeInTheDocument();
        });
        expect(
          screen.getByRole("button", { name: "「個人練習セット」で開始" }),
        ).toBeInTheDocument();
      });
    });

    describe("削除を取りやめた場合", () => {
      it("確認ダイアログでキャンセルすると、削除せず、プリセットは一覧に残る", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await openDeleteDialog(user, "個人練習セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-cancel"));

        // Then
        expect(supabase.deleteEq).not.toHaveBeenCalled();
        expect(screen.getByText("個人練習セット")).toBeInTheDocument();
      });
    });

    describe("削除に失敗した場合", () => {
      it("エラーを表示し、一覧から取り除かず、保存済みからも除かない", async () => {
        // Given
        supabase.deleteEq.mockResolvedValue({
          error: { message: "権限がありません。" },
        });
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await openDeleteDialog(user, "個人練習セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
        expect(
          await screen.findByText("権限がありません。"),
        ).toBeInTheDocument();
        expect(screen.getByText("個人練習セット")).toBeInTheDocument();
        expect(deletePresetFromSnapshot).not.toHaveBeenCalled();
      });

      it("削除確認ダイアログは開いたままで、確認ボタンを再度押せる", async () => {
        // Given
        supabase.deleteEq.mockResolvedValue({
          error: { message: "権限がありません。" },
        });
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await openDeleteDialog(user, "個人練習セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
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

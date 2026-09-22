import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Preset, RoundPresetSelect } from "./round-preset-select-client";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

const db = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  deleteEq: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: db.getSession },
    rpc: db.rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: db.maybeSingle })),
      })),
      delete: vi.fn(() => ({
        eq: db.deleteEq,
      })),
    })),
  }),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
  db.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  db.rpc.mockResolvedValue({ data: "new-round-id", error: null });
  db.deleteEq.mockResolvedValue({ error: null });
});

describe("RoundPresetSelect 選択", () => {
  it("未選択では「プリセット無しで開始」を表示し、個人プリセットが無ければ案内文を出す", () => {
    render(
      <RoundPresetSelect personalPresets={[]} globalPresets={[globalPreset]} />,
    );

    expect(
      screen.getByRole("button", { name: "プリセット無しで開始" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("プリセットとして保存すると、ここに表示されます。"),
    ).toBeInTheDocument();
  });

  it("プリセットをクリックすると選択され、開始ボタンのラベルが変わる。再クリックで解除される", async () => {
    const user = userEvent.setup();
    render(
      <RoundPresetSelect
        personalPresets={[personalPreset]}
        globalPresets={[globalPreset]}
      />,
    );

    await user.click(screen.getAllByTestId("round-preset-button")[0]);
    expect(
      screen.getByRole("button", { name: "「個人練習セット」で開始" }),
    ).toBeInTheDocument();

    await user.click(screen.getAllByTestId("round-preset-button")[0]);
    expect(
      screen.getByRole("button", { name: "プリセット無しで開始" }),
    ).toBeInTheDocument();
  });

  it("公式プリセットも選択でき、開始ボタンのラベルが変わる", async () => {
    const user = userEvent.setup();
    render(
      <RoundPresetSelect
        personalPresets={[personalPreset]}
        globalPresets={[globalPreset]}
      />,
    );

    const buttons = screen.getAllByTestId("round-preset-button");
    await user.click(buttons[buttons.length - 1]);

    expect(
      screen.getByRole("button", { name: "「公式720ラウンド」で開始" }),
    ).toBeInTheDocument();
  });
});

describe("RoundPresetSelect handleStart（プリセット無し）", () => {
  it("デフォルト値でcreate_roundを呼び出し、成功時は新規ラウンドへ遷移する", async () => {
    const user = userEvent.setup();
    render(<RoundPresetSelect personalPresets={[]} globalPresets={[]} />);

    await user.click(
      screen.getByRole("button", { name: "プリセット無しで開始" }),
    );

    await waitFor(() => {
      expect(db.rpc).toHaveBeenCalledWith(
        "create_round",
        expect.objectContaining({
          p_round_event_id: expect.any(String),
          p_id: expect.any(String),
          p_name: "",
          p_format: "outdoor",
          p_bow_type: "recurve",
          p_distances: [],
        }),
      );
    });
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith("/rounds/new-round-id");
    });
  });

  it("未認証の場合はエラーを表示し、create_roundを呼ばない", async () => {
    db.getSession.mockResolvedValue({ data: { session: null } });
    const user = userEvent.setup();
    render(<RoundPresetSelect personalPresets={[]} globalPresets={[]} />);

    await user.click(
      screen.getByRole("button", { name: "プリセット無しで開始" }),
    );

    expect(
      await screen.findByText("サインインが必要です。"),
    ).toBeInTheDocument();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("create_roundがエラーメッセージ付きで失敗した場合、そのメッセージを表示する", async () => {
    db.rpc.mockResolvedValue({
      data: null,
      error: { message: "権限がありません。" },
    });
    const user = userEvent.setup();
    render(<RoundPresetSelect personalPresets={[]} globalPresets={[]} />);

    await user.click(
      screen.getByRole("button", { name: "プリセット無しで開始" }),
    );

    expect(await screen.findByText("権限がありません。")).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("create_roundがエラー無しでroundIdも返さない場合、既定のエラーメッセージを表示する", async () => {
    db.rpc.mockResolvedValue({ data: null, error: null });
    const user = userEvent.setup();
    render(<RoundPresetSelect personalPresets={[]} globalPresets={[]} />);

    await user.click(
      screen.getByRole("button", { name: "プリセット無しで開始" }),
    );

    expect(
      await screen.findByText("ラウンドの作成に失敗しました。"),
    ).toBeInTheDocument();
  });

  it("通信エラー(例外)時は汎用エラーを表示する", async () => {
    db.getSession.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(<RoundPresetSelect personalPresets={[]} globalPresets={[]} />);

    await user.click(
      screen.getByRole("button", { name: "プリセット無しで開始" }),
    );

    expect(
      await screen.findByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
  });

  it("送信中の二重クリックではcreate_roundを1回しか呼ばない", async () => {
    const deferred = createDeferred<{
      data: string | null;
      error: { message: string } | null;
    }>();
    db.rpc.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    render(<RoundPresetSelect personalPresets={[]} globalPresets={[]} />);

    const button = screen.getByRole("button", {
      name: "プリセット無しで開始",
    });
    await user.click(button);
    await user.click(button);

    expect(db.rpc).toHaveBeenCalledTimes(1);
    deferred.resolve({ data: "new-round-id", error: null });
  });
});

describe("RoundPresetSelect handleStart（プリセット選択あり）", () => {
  it("選択中プリセットを取得し、距離をposition_key順に並べ替えてcreate_roundへ渡す", async () => {
    db.maybeSingle.mockResolvedValue({
      data: {
        format: "indoor",
        bow_type: "compound",
        preset_distances: [
          {
            id: "d2",
            position_key: "1-2",
            distance: 18,
            is_marked: true,
            total_ends: 10,
            arrows_per_end: 3,
            target_face_id: "face-2",
          },
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
    const user = userEvent.setup();
    render(
      <RoundPresetSelect
        personalPresets={[personalPreset]}
        globalPresets={[]}
      />,
    );
    await user.click(screen.getAllByTestId("round-preset-button")[0]);

    await user.click(
      screen.getByRole("button", { name: "「個人練習セット」で開始" }),
    );

    await waitFor(() => {
      expect(db.rpc).toHaveBeenCalledWith(
        "create_round",
        expect.objectContaining({
          p_format: "indoor",
          p_bow_type: "compound",
          p_distances: [
            expect.objectContaining({
              position_key: "1-1",
              target_face_id: "face-1",
              distance_event_id: expect.any(String),
              id: expect.any(String),
            }),
            expect.objectContaining({
              position_key: "1-2",
              target_face_id: "face-2",
            }),
          ],
        }),
      );
    });
  });

  it("プリセットの取得に失敗した場合はエラーを表示し、create_roundを呼ばない", async () => {
    db.maybeSingle.mockResolvedValue({ data: null, error: null });
    const user = userEvent.setup();
    render(
      <RoundPresetSelect
        personalPresets={[personalPreset]}
        globalPresets={[]}
      />,
    );
    await user.click(screen.getAllByTestId("round-preset-button")[0]);

    await user.click(
      screen.getByRole("button", { name: "「個人練習セット」で開始" }),
    );

    expect(
      await screen.findByText("プリセットの取得に失敗しました。"),
    ).toBeInTheDocument();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("RoundPresetSelect プリセット削除", () => {
  async function openDeleteDialog(
    user: ReturnType<typeof userEvent.setup>,
    presetName: string,
  ) {
    const row = screen.getByText(presetName).closest("div");
    if (!row) throw new Error(`preset row not found: ${presetName}`);
    await user.click(within(row).getByTestId("round-preset-menu-trigger"));
    await user.click(await screen.findByTestId("round-preset-delete"));
  }

  it("削除を確定すると認証確認後にpreset_roundsを削除し、一覧・選択状態から取り除く", async () => {
    const user = userEvent.setup();
    render(
      <RoundPresetSelect
        personalPresets={[personalPreset]}
        globalPresets={[]}
      />,
    );
    await user.click(screen.getAllByTestId("round-preset-button")[0]);

    await openDeleteDialog(user, "個人練習セット");
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => {
      expect(db.deleteEq).toHaveBeenCalledWith("id", "preset-personal");
    });
    await waitFor(() => {
      expect(screen.queryByText("個人練習セット")).not.toBeInTheDocument();
    });
    // 削除したプリセットが選択中だった場合、開始ボタンは既定表示に戻る。
    expect(
      screen.getByRole("button", { name: "プリセット無しで開始" }),
    ).toBeInTheDocument();
  });

  it("選択中とは別のプリセットを削除しても、選択状態は維持される", async () => {
    const user = userEvent.setup();
    render(
      <RoundPresetSelect
        personalPresets={[personalPreset, otherPersonalPreset]}
        globalPresets={[]}
      />,
    );
    const buttons = screen.getAllByTestId("round-preset-button");
    await user.click(buttons[0]); // 「個人練習セット」を選択

    await openDeleteDialog(user, "別の個人セット");
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => {
      expect(screen.queryByText("別の個人セット")).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "「個人練習セット」で開始" }),
    ).toBeInTheDocument();
  });

  it("未認証の場合はエラーを表示し、削除しない", async () => {
    db.getSession.mockResolvedValue({ data: { session: null } });
    const user = userEvent.setup();
    render(
      <RoundPresetSelect
        personalPresets={[personalPreset]}
        globalPresets={[]}
      />,
    );

    await openDeleteDialog(user, "個人練習セット");
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(
      await screen.findByText("サインインが必要です。"),
    ).toBeInTheDocument();
    expect(db.deleteEq).not.toHaveBeenCalled();
    expect(screen.getByText("個人練習セット")).toBeInTheDocument();
  });

  it("削除に失敗した場合はエラーを表示し、一覧からは取り除かない", async () => {
    db.deleteEq.mockResolvedValue({ error: { message: "権限がありません。" } });
    const user = userEvent.setup();
    render(
      <RoundPresetSelect
        personalPresets={[personalPreset]}
        globalPresets={[]}
      />,
    );

    await openDeleteDialog(user, "個人練習セット");
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(await screen.findByText("権限がありません。")).toBeInTheDocument();
    expect(screen.getByText("個人練習セット")).toBeInTheDocument();
  });

  it("通信エラー(例外)の場合は汎用エラーを表示する", async () => {
    db.getSession.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(
      <RoundPresetSelect
        personalPresets={[personalPreset]}
        globalPresets={[]}
      />,
    );

    await openDeleteDialog(user, "個人練習セット");
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(
      await screen.findByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
  });
});

describe("RoundPresetSelect 送信中にアンマウントされた場合", () => {
  it("ラウンド作成中にアンマウントされた場合、create_roundを呼ばない", async () => {
    const deferred = createDeferred<{
      data: { session: { user: { id: string } } } | { session: null };
    }>();
    db.getSession.mockReturnValue(deferred.promise);
    const user = userEvent.setup();
    const { unmount } = render(
      <RoundPresetSelect personalPresets={[]} globalPresets={[]} />,
    );

    await user.click(
      screen.getByRole("button", { name: "プリセット無しで開始" }),
    );
    unmount();

    deferred.resolve({ data: { session: { user: { id: "user-1" } } } });
    await Promise.resolve();
    await Promise.resolve();

    expect(db.rpc).not.toHaveBeenCalled();
  });
});

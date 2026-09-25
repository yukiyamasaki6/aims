import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TargetFaceOption } from "./distance-config-row";
import { SavePresetDialog } from "./save-preset-dialog";
import type { Distance } from "./scorecard-types";

// SupabaseのSDKは外部サービスとの境界のため、セッションの取得結果とRPCの結果を任意に制御できるスタブで模す。
// 保存の操作は、実物のSupabaseクライアントラッパーを通してこのスタブのrpcに届く。
const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getSession: supabase.getSession },
    rpc: supabase.rpc,
  }),
}));

const targetFace: TargetFaceOption = {
  id: "face-x",
  name: "10点的",
  size: 122,
  format: "outdoor",
  bow_type: ["recurve"],
  target_face_spots: [],
};

const distanceA: Distance = {
  id: "distance-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: targetFace.id,
  is_marked: true,
};

const distanceB: Distance = {
  id: "distance-b",
  position_key: "b",
  distance: 50,
  total_ends: 2,
  arrows_per_end: 3,
  target_face_id: targetFace.id,
  is_marked: true,
};

// 応答を返すまでRPCを保留し、送信中の状態を検証できるようにする。
function holdRpc() {
  let resolveRpc: (value: { error: null }) => void = () => {};
  supabase.rpc.mockReturnValue(
    new Promise((resolve) => {
      resolveRpc = resolve;
    }),
  );
  return () => resolveRpc({ error: null });
}

function setup(
  overrides: Partial<Parameters<typeof SavePresetDialog>[0]> = {},
) {
  const user = userEvent.setup();
  render(
    <SavePresetDialog
      roundName="午前練習"
      format="outdoor"
      bowType="recurve"
      distances={[distanceB, distanceA]}
      targetFaces={[targetFace]}
      {...overrides}
    />,
  );
  return { user };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

describe("SavePresetDialog", () => {
  describe("開く", () => {
    it("名前欄にラウンド名を事前入力し、距離構成から生成した名前をプレースホルダーにする", async () => {
      // Given: 閉じたダイアログ
      const { user } = setup();

      // When: 開く
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // Then: 名前欄にラウンド名が入り、プレースホルダーは並び順の距離から生成した名前になる
      const name = screen.getByTestId("save-as-preset-name");
      expect(name).toHaveValue("午前練習");
      expect(name).toHaveAttribute("placeholder", "70-50");
    });

    it("表示中の構成を距離の並び順で表示し、的が見つからない距離は的未設定と表示する", async () => {
      // Given: 並び順で2つ目の距離の的が、的の一覧に無い
      const { user } = setup({
        distances: [
          { ...distanceB, target_face_id: "face-unknown" },
          distanceA,
        ],
      });

      // When: 開く
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // Then: 種別・弓種と、並び順の距離（70m→50m）が表示され、50mの的は的未設定になる
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "アウトドア / リカーブ70m122cm6本×6エンド50m的未設定3本×2エンド",
      );
    });
  });

  describe("閉じて再度開く", () => {
    it("直前の入力とエラーは破棄される", async () => {
      // Given: 51文字の名前で保存してエラーが表示されている
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.clear(screen.getByTestId("save-as-preset-name"));
      await user.type(
        screen.getByTestId("save-as-preset-name"),
        "あ".repeat(51),
      );
      await user.click(screen.getByTestId("save-as-preset-confirm"));
      expect(
        screen.getByText("プリセット名は50文字以内で入力してください。"),
      ).toBeInTheDocument();

      // When: Escapeで閉じて再度開く
      await user.keyboard("{Escape}");
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // Then: 名前欄はラウンド名に戻り、エラーは表示されない
      expect(screen.getByTestId("save-as-preset-name")).toHaveValue("午前練習");
      expect(
        screen.queryByText("プリセット名は50文字以内で入力してください。"),
      ).not.toBeInTheDocument();
    });
  });

  describe("保存", () => {
    it("入力した名前と表示中の構成でsave_round_as_presetを呼び、ダイアログを閉じる", async () => {
      // Given: 開いたダイアログで名前を入力している
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.clear(screen.getByTestId("save-as-preset-name"));
      await user.type(screen.getByTestId("save-as-preset-name"), "練習用");

      // When: 保存する
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then: 入力した名前と表示中の構成がSDKへ届き、ダイアログが閉じる
      await waitFor(() => {
        expect(
          screen.queryByTestId("save-as-preset-name"),
        ).not.toBeInTheDocument();
      });
      expect(supabase.rpc).toHaveBeenCalledWith("save_round_as_preset", {
        p_name: "練習用",
        p_format: "outdoor",
        p_bow_type: "recurve",
        p_distances: [
          {
            position_key: "b",
            distance: 50,
            total_ends: 2,
            arrows_per_end: 3,
            target_face_id: "face-x",
            is_marked: true,
          },
          {
            position_key: "a",
            distance: 70,
            total_ends: 6,
            arrows_per_end: 6,
            target_face_id: "face-x",
            is_marked: true,
          },
        ],
      });
    });

    it("送信中は確定ボタンを無効表示にし、連打しても二重送信しない", async () => {
      // Given: 保存の応答を保留している
      const resolveRpc = holdRpc();
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When: 確定ボタンを連打する
      await user.click(screen.getByTestId("save-as-preset-confirm"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then: 送信中は無効表示になり、応答後に閉じるまでSDKへは1回だけ届く
      expect(screen.getByTestId("save-as-preset-confirm")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      resolveRpc();
      await waitFor(() => {
        expect(
          screen.queryByTestId("save-as-preset-name"),
        ).not.toBeInTheDocument();
      });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it("送信中はEscapeで閉じず、応答後に閉じる", async () => {
      // Given: 保存の応答を保留している
      const resolveRpc = holdRpc();
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // When: 送信中にEscapeを押す
      await user.keyboard("{Escape}");

      // Then: 閉じず、応答が返ると閉じる
      expect(screen.getByTestId("save-as-preset-name")).toBeInTheDocument();
      resolveRpc();
      await waitFor(() => {
        expect(
          screen.queryByTestId("save-as-preset-name"),
        ).not.toBeInTheDocument();
      });
    });

    it("名前が50文字を超える場合は送信せず、エラーを表示する", async () => {
      // Given: 51文字の名前を入力している
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.clear(screen.getByTestId("save-as-preset-name"));
      await user.type(
        screen.getByTestId("save-as-preset-name"),
        "あ".repeat(51),
      );

      // When: 保存する
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then: エラーが表示され、名前欄が不正な入力として示され、SDKへは届かない
      expect(
        screen.getByText("プリセット名は50文字以内で入力してください。"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("save-as-preset-name")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("未認証の場合は送信せず、エラーを表示してダイアログを開いたままにする", async () => {
      // Given: サインインしていない
      supabase.getSession.mockResolvedValue({ data: { session: null } });
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When: 保存する
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then: エラーが表示され、ダイアログは開いたままで、SDKのrpcへは届かない
      expect(
        await screen.findByText("サインインが必要です。"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("save-as-preset-name")).toBeInTheDocument();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("save_round_as_presetが失敗した場合は、エラーを表示してダイアログを開いたままにする", async () => {
      // Given: 保存が失敗する
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: "保存に失敗しました。" },
      });
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When: 保存する
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then: エラーが表示され、ダイアログは開いたままで、確定ボタンは再び押せる
      expect(
        await screen.findByText("保存に失敗しました。"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("save-as-preset-name")).toHaveValue("午前練習");
      expect(screen.getByTestId("save-as-preset-confirm")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    });
  });
});

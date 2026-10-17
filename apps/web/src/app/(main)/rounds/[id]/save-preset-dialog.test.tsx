import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Distance } from "@/features/rounds/scorecard-types";
import type { TargetFaceOption } from "@/features/rounds/target-face-types";
import { fetchPresets } from "../_shared/fetch-presets";
import { SavePresetDialog } from "./save-preset-dialog";

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

// 保存の成功後の背景の再取得は、取得の境界として呼ばれたことだけを確かめる。
vi.mock("../_shared/fetch-presets", () => ({ fetchPresets: vi.fn() }));

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
  total_ends: 6,
  arrows_per_end: 6,
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
      // Given
      const { user } = setup();

      // When
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // Then
      const name = screen.getByTestId("save-as-preset-name");
      expect(name).toHaveValue("午前練習");
      expect(name).toHaveAttribute("placeholder", "70-50");
    });

    it("表示中の構成を距離の並び順で表示し、的が見つからない距離は「的データを取得できません」と表示する", async () => {
      // Given
      const { user } = setup({
        distances: [
          { ...distanceB, target_face_id: "face-unknown" },
          distanceA,
        ],
      });

      // When
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // Then
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent("アウトドア / リカーブ");
      const text = dialog.textContent ?? "";
      expect(text.indexOf("70m")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("70m")).toBeLessThan(text.indexOf("50m"));
      expect(dialog).toHaveTextContent("的データを取得できません");
    });
  });

  describe("閉じて再度開く", () => {
    it("直前の入力とエラーは破棄される", async () => {
      // Given
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

      // When
      await user.keyboard("{Escape}");
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // Then
      expect(screen.getByTestId("save-as-preset-name")).toHaveValue("午前練習");
      expect(
        screen.queryByText("プリセット名は50文字以内で入力してください。"),
      ).not.toBeInTheDocument();
    });
  });

  describe("背景のクリック", () => {
    it("開いたダイアログの背景を押すと、保存せずに閉じる", async () => {
      // Given
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      const backdrops = document.querySelectorAll(".bg-black\\/40");

      // When
      await user.click(backdrops[backdrops.length - 1]);

      // Then
      await waitFor(() => {
        expect(
          screen.queryByTestId("save-as-preset-name"),
        ).not.toBeInTheDocument();
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe("保存", () => {
    it("入力した名前と表示中の構成でsave_round_as_presetを呼び、ダイアログを閉じる", async () => {
      // Given
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.clear(screen.getByTestId("save-as-preset-name"));
      await user.type(screen.getByTestId("save-as-preset-name"), "練習用");

      // When
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then
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
            position_key: "a",
            distance: 70,
            total_ends: 6,
            arrows_per_end: 6,
            target_face_id: "face-x",
            is_marked: true,
          },
          {
            position_key: "b",
            distance: 50,
            total_ends: 6,
            arrows_per_end: 6,
            target_face_id: "face-x",
            is_marked: true,
          },
        ],
      });
      // 成功したので、プリセット一覧を背景で再取得して保存済みを更新する
      expect(fetchPresets).toHaveBeenCalledTimes(1);
    });

    it("送信中は確定ボタンを無効表示にする", async () => {
      // Given
      holdRpc();
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then
      expect(screen.getByTestId("save-as-preset-confirm")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    it("送信中に連打した後に応答が返ると、閉じて、SDKへは1回だけ届く", async () => {
      // Given
      const resolveRpc = holdRpc();
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // When
      resolveRpc();

      // Then
      await waitFor(() => {
        expect(
          screen.queryByTestId("save-as-preset-name"),
        ).not.toBeInTheDocument();
      });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it("送信中はEscapeで閉じない", async () => {
      // Given
      holdRpc();
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(screen.getByTestId("save-as-preset-name")).toBeInTheDocument();
    });

    it("送信中にEscapeを押した後に応答が返ると、閉じる", async () => {
      // Given
      const resolveRpc = holdRpc();
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));
      await user.keyboard("{Escape}");

      // When
      resolveRpc();

      // Then
      await waitFor(() => {
        expect(
          screen.queryByTestId("save-as-preset-name"),
        ).not.toBeInTheDocument();
      });
    });

    it("名前が50文字を超える場合は送信せず、エラーを表示する", async () => {
      // Given
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.clear(screen.getByTestId("save-as-preset-name"));
      await user.type(
        screen.getByTestId("save-as-preset-name"),
        "あ".repeat(51),
      );

      // When
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then
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
      // Given
      supabase.getSession.mockResolvedValue({ data: { session: null } });
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then
      expect(
        await screen.findByText("サインインが必要です。"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("save-as-preset-name")).toBeInTheDocument();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("セッションの確認が通信失敗で不明な場合は、サインインを求めず通信エラーを表示してダイアログを開いたままにする", async () => {
      // Given
      supabase.getSession.mockResolvedValue({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then
      expect(
        await screen.findByText(
          "通信エラーが発生しました。しばらくしてから再度お試しください。",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("サインインが必要です。"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("save-as-preset-name")).toBeInTheDocument();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("save_round_as_presetが失敗した場合は、エラーを表示してダイアログを開いたままにする", async () => {
      // Given
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: "保存に失敗しました。" },
      });
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then
      expect(
        await screen.findByText("保存に失敗しました。"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("save-as-preset-name")).toHaveValue("午前練習");
      expect(screen.getByTestId("save-as-preset-confirm")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
      expect(fetchPresets).not.toHaveBeenCalled();
    });
  });

  describe("名前欄のEnterキー", () => {
    it("名前欄でEnterを押しても、保存せずダイアログも閉じない", async () => {
      // Given
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      const name = screen.getByTestId("save-as-preset-name");
      await user.click(name);

      // When
      await user.keyboard("{Enter}");

      // Then
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});

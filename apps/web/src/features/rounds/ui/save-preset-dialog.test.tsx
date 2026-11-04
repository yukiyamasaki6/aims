import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresetToSave } from "@/features/rounds/domain/preset-save";
import type { Distance } from "@/features/rounds/domain/scorecard-types";
import type { TargetFaceOption } from "@/features/rounds/domain/target-face";
import { createFakeRoundDetailStore } from "@/features/rounds/ui/round-stores-test-helpers";
import { RoundDetailStoreProvider } from "@/features/rounds/ui/rounds-context";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { SavePresetDialog } from "./save-preset-dialog";

// 保存の手続き(サインインの確認、書き込み、再取得)は、ラウンドの状態と変更の方法の偽のsavePresetで受ける。手続きの規則は手続きのテスト、実物の結線はスコアカードのテストが確かめる。
const fake = createFakeRoundDetailStore();
const savePreset = fake.store.savePreset;

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

// 結果を返すまで保存を保留し、送信中の状態を検証できるようにする。
function holdSave() {
  let resolveSave: (value: { status: "saved" }) => void = () => {};
  savePreset.mockReturnValue(
    new Promise((resolve) => {
      resolveSave = resolve;
    }),
  );
  return () => resolveSave({ status: "saved" });
}

function setup(
  overrides: Partial<Parameters<typeof SavePresetDialog>[0]> = {},
) {
  const user = userEvent.setup();
  render(
    <RoundDetailStoreProvider store={fake.store}>
      <SavePresetDialog
        roundName="午前練習"
        format="outdoor"
        bowType="recurve"
        distances={[distanceB, distanceA]}
        targetFaces={[targetFace]}
        {...overrides}
      />
    </RoundDetailStoreProvider>,
    { wrapper: IntlTestProvider },
  );
  return { user };
}

beforeEach(() => {
  vi.clearAllMocks();
  savePreset.mockResolvedValue({ status: "saved" });
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
      expect(savePreset).not.toHaveBeenCalled();
    });
  });

  describe("保存", () => {
    it("入力した名前と表示中の構成で保存の手続きを呼び、ダイアログを閉じる", async () => {
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
      const expected: PresetToSave = {
        name: "練習用",
        format: "outdoor",
        bowType: "recurve",
        distances: [
          {
            positionKey: "a",
            distance: 70,
            totalEnds: 6,
            arrowsPerEnd: 6,
            targetFaceId: "face-x",
            isMarked: true,
          },
          {
            positionKey: "b",
            distance: 50,
            totalEnds: 6,
            arrowsPerEnd: 6,
            targetFaceId: "face-x",
            isMarked: true,
          },
        ],
      };
      expect(savePreset).toHaveBeenCalledExactlyOnceWith(expected);
    });

    it("送信中は確定ボタンを無効表示にする", async () => {
      // Given
      holdSave();
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

    it("送信中に連打した後に応答が返ると、閉じて、保存は1回だけ呼ばれる", async () => {
      // Given
      const resolveSave = holdSave();
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // When
      resolveSave();

      // Then
      await waitFor(() => {
        expect(
          screen.queryByTestId("save-as-preset-name"),
        ).not.toBeInTheDocument();
      });
      expect(savePreset).toHaveBeenCalledTimes(1);
    });

    it("送信中はEscapeで閉じない", async () => {
      // Given
      holdSave();
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
      const resolveSave = holdSave();
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));
      await user.keyboard("{Escape}");

      // When
      resolveSave();

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
      expect(savePreset).not.toHaveBeenCalled();
    });

    it("サインインの確認で失敗の結果が返ると、その文言を表示してダイアログを開いたままにする", async () => {
      // Given
      savePreset.mockResolvedValue({
        status: "failed",
        error: "unauthenticated",
      });
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then
      expect(
        await screen.findByText("サインインが必要です。"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("save-as-preset-name")).toHaveValue("午前練習");
    });

    it("1回目は保存して閉じ、再度開いて確定した2回目の失敗の結果を表示する", async () => {
      // Given
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));
      await user.click(screen.getByTestId("save-as-preset-confirm"));
      await waitFor(() => {
        expect(
          screen.queryByTestId("save-as-preset-name"),
        ).not.toBeInTheDocument();
      });
      savePreset.mockResolvedValue({
        status: "failed",
        error: "unauthenticated",
      });
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then
      expect(
        await screen.findByText("サインインが必要です。"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("save-as-preset-name")).toBeInTheDocument();
      expect(savePreset).toHaveBeenCalledTimes(2);
    });

    it("通信エラーの文言の結果が返ると、その文言だけを表示し、サインインを求めず、開いたままにする", async () => {
      // Given
      savePreset.mockResolvedValue({
        status: "failed",
        error: "unreachable",
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
    });

    it("保存の手続きが固定の失敗の文言を返すと、その文言だけを表示し、名前欄を残して確定ボタンを有効にしたまま開いておく", async () => {
      // Given
      savePreset.mockResolvedValue({
        status: "failed",
        error: "saveFailed",
      });
      const { user } = setup();
      await user.click(screen.getByTestId("save-as-preset-trigger"));

      // When
      await user.click(screen.getByTestId("save-as-preset-confirm"));

      // Then
      expect(
        await screen.findByText("保存できませんでした。"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("保存に失敗しました。"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("save-as-preset-name")).toHaveValue("午前練習");
      expect(screen.getByTestId("save-as-preset-confirm")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
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
      expect(savePreset).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});

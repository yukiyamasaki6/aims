import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DistanceConfig } from "./distance-config";
import {
  DistanceEditFields,
  type TargetFaceOption,
} from "./distance-config-row";

const targetFaceOutdoorRecurve: TargetFaceOption = {
  id: "face-outdoor-recurve",
  name: "10点的アウトドア",
  size: 122,
  format: "outdoor",
  bow_type: ["recurve", "compound"],
  target_face_spots: [],
};

const targetFaceIndoorCompound: TargetFaceOption = {
  id: "face-indoor-compound",
  name: "5点的インドア",
  size: 40,
  format: "indoor",
  bow_type: ["compound"],
  target_face_spots: [],
};

const targetFaces = [targetFaceOutdoorRecurve, targetFaceIndoorCompound];

const baseDistance: DistanceConfig = {
  id: "distance-1",
  distanceNumber: 1,
  distance: 70,
  totalEnds: 6,
  arrowsPerEnd: 6,
  targetFaceId: targetFaceOutdoorRecurve.id,
  isMarked: false,
};

const EVENT_ID = "00000000-0000-4000-8000-000000000001";

function setup(
  overrides: Partial<Parameters<typeof DistanceEditFields>[0]> = {},
) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const onOpenChange = vi.fn();
  const enqueue = vi.fn();
  const utils = render(
    <DistanceEditFields
      distance={baseDistance}
      hasShots={false}
      targetFaces={targetFaces}
      roundFormat="outdoor"
      roundBowType="recurve"
      onSaved={onSaved}
      onDeleted={onDeleted}
      onOpenChange={onOpenChange}
      enqueue={enqueue}
      {...overrides}
    />,
  );
  return { onSaved, onDeleted, onOpenChange, enqueue, ...utils };
}

describe("DistanceEditFields", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("表示", () => {
    describe("roundFormatがfield以外の場合", () => {
      it("Marked/Unmarkedの切り替えを表示しない", () => {
        // Given: アウトドアのラウンド
        const props = { roundFormat: "outdoor" };

        // When: 表示する
        setup(props);

        // Then: Marked/Unmarkedの切り替えがない
        expect(
          screen.queryByTestId("distance-config-marked-1"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("distance-config-unmarked-1"),
        ).not.toBeInTheDocument();
      });
    });

    describe("roundFormatがfieldの場合", () => {
      it("Marked/Unmarkedの切り替えを表示する", () => {
        // Given: フィールドのラウンド
        const props = { roundFormat: "field" };

        // When: 表示する
        setup(props);

        // Then: Marked/Unmarkedの切り替えがある
        expect(
          screen.getByTestId("distance-config-marked-1"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("distance-config-unmarked-1"),
        ).toBeInTheDocument();
      });
    });

    describe("hasShotsがtrueの場合", () => {
      it("的・本数・エンド数の入力が無効化される（距離は編集可能）", () => {
        // Given: スコア記録済みの距離
        const props = { hasShots: true };

        // When: 表示する
        setup(props);

        // Then: 距離以外の入力が無効になる
        expect(screen.getByTestId("target-face-picker-trigger")).toBeDisabled();
        expect(screen.getByTestId("distance-config-arrows-1")).toBeDisabled();
        expect(
          screen.getByTestId("distance-config-total-ends-1"),
        ).toBeDisabled();
        expect(
          screen.getByTestId("distance-config-distance-1"),
        ).not.toBeDisabled();
      });

      it("的選択トリガーのラベルに変更不可の理由を示す", () => {
        // Given: スコア記録済みの距離
        const props = { hasShots: true };

        // When: 表示する
        setup(props);

        // Then: 的の名称と変更不可の理由をラベルに含む
        expect(
          screen.getByLabelText(
            `${targetFaceOutdoorRecurve.name}（スコア記録済みのため変更不可）`,
          ),
        ).toBeInTheDocument();
      });

      it("選択中の的が存在しなければ、ラベルは「的（スコア記録済みのため変更不可）」になる", () => {
        // Given: 存在しない的を選んだスコア記録済みの距離
        const props = {
          hasShots: true,
          distance: { ...baseDistance, targetFaceId: "unknown-face" },
        };

        // When: 表示する
        setup(props);

        // Then: 的の名称の代わりに「的」を使う
        expect(
          screen.getByLabelText("的（スコア記録済みのため変更不可）"),
        ).toBeInTheDocument();
      });
    });

    describe("選択中の的が存在しない場合", () => {
      it("的選択トリガーのラベルは「的を選択」になる", () => {
        // Given: 存在しない的を選んだ距離
        const props = {
          distance: { ...baseDistance, targetFaceId: "unknown-face" },
        };

        // When: 表示する
        setup(props);

        // Then: 的の選択を促すラベルになる
        expect(screen.getByLabelText("的を選択")).toBeInTheDocument();
      });
    });
  });

  describe("保存", () => {
    describe("入力内容が有効な場合", () => {
      it("onSavedとenqueueを検証済みの距離設定で呼ぶ", async () => {
        // Given: 距離・本数・エンド数を編集したフォーム
        vi.spyOn(crypto, "randomUUID").mockReturnValue(EVENT_ID);
        const user = userEvent.setup();
        const { onSaved, enqueue } = setup();
        await user.clear(screen.getByTestId("distance-config-distance-1"));
        await user.type(screen.getByTestId("distance-config-distance-1"), "50");
        await user.clear(screen.getByTestId("distance-config-arrows-1"));
        await user.type(screen.getByTestId("distance-config-arrows-1"), "3");
        await user.clear(screen.getByTestId("distance-config-total-ends-1"));
        await user.type(
          screen.getByTestId("distance-config-total-ends-1"),
          "10",
        );

        // When: 保存する
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then: 距離設定を通知し、distance.updatedの操作を登録する
        expect(onSaved).toHaveBeenCalledWith({
          id: "distance-1",
          distanceNumber: 1,
          distance: 50,
          totalEnds: 10,
          arrowsPerEnd: 3,
          targetFaceId: "face-outdoor-recurve",
          isMarked: false,
        });
        expect(enqueue).toHaveBeenCalledWith({
          key: "distance:distance-1",
          label: "距離1",
          operation: {
            type: "distance.updated",
            eventId: EVENT_ID,
            distanceId: "distance-1",
            distance: 50,
            totalEnds: 10,
            arrowsPerEnd: 3,
            targetFaceId: "face-outdoor-recurve",
            isMarked: false,
          },
        });
      });
    });

    describe("入力内容が無効な場合", () => {
      it("各項目のエラーを表示し、onSavedもenqueueも呼ばない", async () => {
        // Given: Markedに切り替え、距離・本数・エンド数を空にしたフォーム
        const user = userEvent.setup();
        const { onSaved, enqueue } = setup({ roundFormat: "field" });
        await user.click(screen.getByTestId("distance-config-marked-1"));
        await user.clear(screen.getByTestId("distance-config-distance-1"));
        await user.clear(screen.getByTestId("distance-config-arrows-1"));
        await user.clear(screen.getByTestId("distance-config-total-ends-1"));

        // When: 保存する
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then: 各項目のエラーを表示し、保存も同期操作の登録もしない
        expect(
          screen.getByText("距離を入力してください。"),
        ).toBeInTheDocument();
        expect(
          screen.getAllByText("1以上の整数を入力してください。"),
        ).toHaveLength(2);
        expect(onSaved).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      });
    });
  });

  describe("削除", () => {
    describe("スコア未記録の場合", () => {
      it("確認なしにonDeletedとenqueueを呼ぶ", async () => {
        // Given: スコア未記録の距離
        vi.spyOn(crypto, "randomUUID").mockReturnValue(EVENT_ID);
        const user = userEvent.setup();
        const { onDeleted, enqueue } = setup({ hasShots: false });

        // When: 削除ボタンをクリックする
        await user.click(screen.getByTestId("distance-config-delete-1"));

        // Then: 削除を通知し、distance.disabledの操作を登録する
        expect(onDeleted).toHaveBeenCalled();
        expect(enqueue).toHaveBeenCalledWith({
          key: "distance:distance-1",
          label: "距離1",
          operation: {
            type: "distance.disabled",
            eventId: EVENT_ID,
            distanceId: "distance-1",
          },
        });
      });
    });

    describe("スコア記録済みの場合", () => {
      it("確認ダイアログを表示し、確認後に削除する", async () => {
        // Given: スコア記録済みの距離
        const user = userEvent.setup();
        const { onDeleted, enqueue } = setup({ hasShots: true });

        // When: 削除ボタンをクリックする
        await user.click(screen.getByTestId("distance-config-delete-1"));

        // Then: 確認ダイアログを表示し、まだ削除しない
        expect(
          screen.getByText(
            "この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？",
          ),
        ).toBeInTheDocument();
        expect(onDeleted).not.toHaveBeenCalled();

        // When: 確認する
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then: 削除を通知し、同期操作を登録する
        expect(onDeleted).toHaveBeenCalled();
        expect(enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            operation: expect.objectContaining({ type: "distance.disabled" }),
          }),
        );
      });

      it("確認をキャンセルすると削除しない", async () => {
        // Given: 削除の確認ダイアログを開いた状態
        const user = userEvent.setup();
        const { onDeleted, enqueue } = setup({ hasShots: true });
        await user.click(screen.getByTestId("distance-config-delete-1"));

        // When: キャンセルする
        await user.click(screen.getByTestId("confirm-dialog-cancel"));

        // Then: 削除も同期操作の登録もしない
        expect(onDeleted).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      });
    });
  });

  describe("Escapeキー", () => {
    it("onOpenChangeをfalseで呼ぶ", async () => {
      // Given: 表示中のフォーム
      const user = userEvent.setup();
      const { onOpenChange } = setup();

      // When: Escapeキーを押す
      await user.keyboard("{Escape}");

      // Then: 閉じるよう通知する
      expect(onOpenChange).toHaveBeenCalledWith(
        false,
        expect.objectContaining({ reason: "escape-key" }),
      );
    });
  });

  describe("的選択ポップアップ", () => {
    describe("開いた直後", () => {
      it("ラウンドの種別・弓種で絞り込んだ的を表示する", async () => {
        // Given: アウトドア・リカーブのラウンドの距離
        const user = userEvent.setup();
        setup();

        // When: 的選択ポップアップを開く
        await user.click(screen.getByTestId("target-face-picker-trigger"));

        // Then: ラウンドの種別・弓種に合う的だけを表示する
        expect(
          screen.getByTestId(
            `target-face-option-${targetFaceOutdoorRecurve.id}`,
          ),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId(
            `target-face-option-${targetFaceIndoorCompound.id}`,
          ),
        ).not.toBeInTheDocument();
      });
    });

    describe("タブの切り替え", () => {
      it("選んだ種別・弓種で絞り込み直す", async () => {
        // Given: 的選択ポップアップを開いた状態
        const user = userEvent.setup();
        setup();
        await user.click(screen.getByTestId("target-face-picker-trigger"));

        // When: 種別・弓種とも「すべて」タブに切り替える
        await user.click(screen.getByTestId("target-face-format-tab-all"));
        await user.click(screen.getByTestId("target-face-bow-type-tab-all"));

        // Then: 絞り込みが解除される
        expect(
          screen.getByTestId(
            `target-face-option-${targetFaceOutdoorRecurve.id}`,
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId(
            `target-face-option-${targetFaceIndoorCompound.id}`,
          ),
        ).toBeInTheDocument();
      });
    });

    describe("的の選択", () => {
      it("ポップアップが閉じ、選択内容が保存に反映される", async () => {
        // Given: 的選択ポップアップで全件を表示した状態
        const user = userEvent.setup();
        const { enqueue } = setup();
        await user.click(screen.getByTestId("target-face-picker-trigger"));
        await user.click(screen.getByTestId("target-face-format-tab-all"));
        await user.click(screen.getByTestId("target-face-bow-type-tab-all"));

        // When: 的を選択する
        await user.click(
          screen.getByTestId(
            `target-face-option-${targetFaceIndoorCompound.id}`,
          ),
        );

        // Then: ポップアップが閉じる
        expect(
          screen.queryByTestId(
            `target-face-option-${targetFaceIndoorCompound.id}`,
          ),
        ).not.toBeInTheDocument();

        // When: 保存する
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then: 選択した的で同期操作を登録する
        expect(enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            operation: expect.objectContaining({
              targetFaceId: targetFaceIndoorCompound.id,
            }),
          }),
        );
      });
    });
  });
});

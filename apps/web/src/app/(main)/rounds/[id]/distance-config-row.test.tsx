import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DistanceConfig,
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("有効な入力で保存すると、onSavedとenqueueが正しい内容で呼ばれる", async () => {
    const user = userEvent.setup();
    const { onSaved, enqueue } = setup();

    await user.clear(screen.getByTestId("distance-config-distance-1"));
    await user.type(screen.getByTestId("distance-config-distance-1"), "50");
    await user.clear(screen.getByTestId("distance-config-arrows-1"));
    await user.type(screen.getByTestId("distance-config-arrows-1"), "3");
    await user.clear(screen.getByTestId("distance-config-total-ends-1"));
    await user.type(screen.getByTestId("distance-config-total-ends-1"), "10");
    await user.click(screen.getByTestId("distance-config-save-1"));

    const expected = {
      ...baseDistance,
      distance: 50,
      arrowsPerEnd: 3,
      totalEnds: 10,
    };
    expect(onSaved).toHaveBeenCalledWith(expected);
    expect(enqueue).toHaveBeenCalledWith({
      key: "distance:distance-1",
      label: "距離1",
      operation: {
        type: "distance.updated",
        eventId: expect.any(String),
        distanceId: "distance-1",
        distance: 50,
        totalEnds: 10,
        arrowsPerEnd: 3,
        targetFaceId: baseDistance.targetFaceId,
        isMarked: false,
      },
    });
  });

  it.each([
    ["未入力", ""],
    ["整数でない", "1.5"],
    ["1未満", "0"],
  ])(
    "エンドあたりの本数が%sの場合、保存できずエラーを表示する",
    async (_label, value) => {
      const user = userEvent.setup();
      const { onSaved, enqueue } = setup();

      const input = screen.getByTestId("distance-config-arrows-1");
      await user.clear(input);
      if (value) await user.type(input, value);
      await user.click(screen.getByTestId("distance-config-save-1"));

      expect(
        screen.getByText("1以上の整数を入力してください。"),
      ).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["未入力", ""],
    ["整数でない", "1.5"],
    ["1未満", "0"],
  ])(
    "総エンド数が%sの場合、保存できずエラーを表示する",
    async (_label, value) => {
      const user = userEvent.setup();
      const { onSaved, enqueue } = setup();

      const input = screen.getByTestId("distance-config-total-ends-1");
      await user.clear(input);
      if (value) await user.type(input, value);
      await user.click(screen.getByTestId("distance-config-save-1"));

      expect(
        screen.getByText("1以上の整数を入力してください。"),
      ).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it("Markedの状態で距離が未入力の場合、保存できずエラーを表示する", async () => {
    const user = userEvent.setup();
    const { onSaved, enqueue } = setup({ roundFormat: "field" });

    await user.click(screen.getByTestId("distance-config-marked-1"));
    await user.clear(screen.getByTestId("distance-config-distance-1"));
    await user.click(screen.getByTestId("distance-config-save-1"));

    expect(screen.getByText("距離を入力してください。")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("Unmarkedの状態では距離が未入力でも保存できる", async () => {
    const user = userEvent.setup();
    const { onSaved, enqueue } = setup({ roundFormat: "field" });

    await user.clear(screen.getByTestId("distance-config-distance-1"));
    await user.click(screen.getByTestId("distance-config-save-1"));

    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ distance: null, isMarked: false }),
    );
    expect(enqueue).toHaveBeenCalled();
  });

  it("roundFormatがfield以外の場合はMarked/Unmarkedの切り替えを表示しない", () => {
    setup({ roundFormat: "outdoor" });

    expect(
      screen.queryByTestId("distance-config-marked-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("distance-config-unmarked-1"),
    ).not.toBeInTheDocument();
  });

  it("roundFormatがfieldの場合はMarked/Unmarkedの切り替えを表示する", () => {
    setup({ roundFormat: "field" });

    expect(screen.getByTestId("distance-config-marked-1")).toBeInTheDocument();
    expect(
      screen.getByTestId("distance-config-unmarked-1"),
    ).toBeInTheDocument();
  });

  it("hasShotsがtrueの場合、的・本数・エンド数の入力が無効化される（距離は編集可能）", () => {
    setup({ hasShots: true });

    expect(screen.getByTestId("target-face-picker-trigger")).toBeDisabled();
    expect(screen.getByTestId("distance-config-arrows-1")).toBeDisabled();
    expect(screen.getByTestId("distance-config-total-ends-1")).toBeDisabled();
    expect(screen.getByTestId("distance-config-distance-1")).not.toBeDisabled();
  });

  it("スコア未記録の場合、削除ボタンをクリックすると確認なしに即座に削除される", async () => {
    const user = userEvent.setup();
    const { onDeleted, enqueue } = setup({ hasShots: false });

    await user.click(screen.getByTestId("distance-config-delete-1"));

    expect(onDeleted).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith({
      key: "distance:distance-1",
      label: "距離1",
      operation: {
        type: "distance.disabled",
        eventId: expect.any(String),
        distanceId: "distance-1",
      },
    });
  });

  it("スコア記録済みの場合、削除ボタンをクリックすると確認ダイアログを表示し、確認後に削除される", async () => {
    const user = userEvent.setup();
    const { onDeleted, enqueue } = setup({ hasShots: true });

    await user.click(screen.getByTestId("distance-config-delete-1"));
    expect(
      screen.getByText(
        "この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？",
      ),
    ).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(onDeleted).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalled();
  });

  it("スコア記録済みの削除確認をキャンセルすると削除されない", async () => {
    const user = userEvent.setup();
    const { onDeleted, enqueue } = setup({ hasShots: true });

    await user.click(screen.getByTestId("distance-config-delete-1"));
    await user.click(screen.getByTestId("confirm-dialog-cancel"));

    expect(onDeleted).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("Escapeキーで閉じるとonOpenChangeがfalseで呼ばれる", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = setup();

    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ reason: "escape-key" }),
    );
  });

  it("的選択ポップアップは初期状態でラウンドの種別・弓種に合う的だけを表示する", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("target-face-picker-trigger"));

    expect(
      screen.getByTestId(`target-face-option-${targetFaceOutdoorRecurve.id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`target-face-option-${targetFaceIndoorCompound.id}`),
    ).not.toBeInTheDocument();
  });

  it("的選択ポップアップで「すべて」タブに切り替えると絞り込みが解除される", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("target-face-picker-trigger"));
    await user.click(screen.getByTestId("target-face-format-tab-all"));
    await user.click(screen.getByTestId("target-face-bow-type-tab-all"));

    expect(
      screen.getByTestId(`target-face-option-${targetFaceOutdoorRecurve.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`target-face-option-${targetFaceIndoorCompound.id}`),
    ).toBeInTheDocument();
  });

  it("的を選択するとポップアップが閉じ、選択内容が保存に反映される", async () => {
    const user = userEvent.setup();
    const { enqueue } = setup();

    await user.click(screen.getByTestId("target-face-picker-trigger"));
    await user.click(screen.getByTestId("target-face-format-tab-all"));
    await user.click(screen.getByTestId("target-face-bow-type-tab-all"));
    await user.click(
      screen.getByTestId(`target-face-option-${targetFaceIndoorCompound.id}`),
    );

    expect(
      screen.queryByTestId(`target-face-option-${targetFaceIndoorCompound.id}`),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("distance-config-save-1"));

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({
          targetFaceId: targetFaceIndoorCompound.id,
        }),
      }),
    );
  });

  it("hasShotsがtrueの場合、的選択トリガーが無効化され、ラベルに変更不可の理由を示す", () => {
    setup({ hasShots: true });

    expect(
      screen.getByLabelText(
        `${targetFaceOutdoorRecurve.name}（スコア記録済みのため変更不可）`,
      ),
    ).toBeInTheDocument();
  });

  it("選択中の的が存在しない場合、トリガーのラベルは「的を選択」になる", () => {
    setup({
      distance: { ...baseDistance, targetFaceId: "unknown-face" },
    });

    expect(screen.getByLabelText("的を選択")).toBeInTheDocument();
  });

  it("無効化かつ選択中の的が存在しない場合、ラベルは「的（スコア記録済みのため変更不可）」になる", () => {
    setup({
      hasShots: true,
      distance: { ...baseDistance, targetFaceId: "unknown-face" },
    });

    expect(
      screen.getByLabelText("的（スコア記録済みのため変更不可）"),
    ).toBeInTheDocument();
  });
});

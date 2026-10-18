import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TargetFaceOption } from "@/features/rounds/target-face-types";
import type { DistanceConfig } from "./distance-config";
import { DistanceEditFields } from "./distance-edit-fields";

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
  isMarked: true,
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
        // Given
        // When
        setup({ roundFormat: "outdoor" });

        // Then
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
        // Given
        // When
        setup({ roundFormat: "field" });

        // Then
        expect(
          screen.getByTestId("distance-config-marked-1"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("distance-config-unmarked-1"),
        ).toBeInTheDocument();
      });
    });

    describe("hasShotsがtrueの場合", () => {
      it("的・本数・エンド数が編集不可になる（距離は編集可能）", () => {
        // Given
        // When
        setup({ hasShots: true });

        // Then
        expect(
          screen.getByTestId("target-face-picker-trigger"),
        ).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByTestId("distance-config-arrows-1")).toHaveAttribute(
          "readonly",
        );
        expect(
          screen.getByTestId("distance-config-total-ends-1"),
        ).toHaveAttribute("readonly");
        expect(
          screen.getByTestId("distance-config-distance-1"),
        ).not.toHaveAttribute("readonly");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });

      it.each([
        ["distance-config-arrows-1", "本数"],
        ["distance-config-total-ends-1", "総エンド数"],
      ])(
        "%sを押すとメッセージが表示され、値は変わらない（%s）",
        async (testId) => {
          // Given
          const user = userEvent.setup();
          const { onSaved } = setup({ hasShots: true });
          const input = screen.getByTestId(testId);
          const before = (input as HTMLInputElement).value;

          // When
          await user.click(input);
          await user.type(input, "9");

          // Then
          expect(screen.getByRole("alert")).toHaveTextContent(
            "スコアが記録済みのため変更できません",
          );
          expect(
            screen.getByTestId(`${testId}-locked-message`),
          ).toBeInTheDocument();
          expect(input).toHaveAttribute("aria-describedby", `${testId}-locked`);
          expect((input as HTMLInputElement).value).toBe(before);
          expect(onSaved).not.toHaveBeenCalled();
        },
      );

      it("的を押すとメッセージが表示され、的選択ダイアログは開かない", async () => {
        // Given
        const user = userEvent.setup();
        const { onSaved } = setup({ hasShots: true });

        // When
        await user.click(screen.getByTestId("target-face-picker-trigger"));

        // Then
        expect(
          screen.getByTestId("distance-config-target-face-locked-message"),
        ).toHaveTextContent("スコアが記録済みのため変更できません");
        expect(
          screen.queryByTestId(
            `target-face-option-${targetFaceOutdoorRecurve.id}`,
          ),
        ).not.toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
      });

      it("別の項目を押すと、メッセージは押した項目に移る", async () => {
        // Given
        const user = userEvent.setup();
        setup({ hasShots: true });
        await user.click(screen.getByTestId("distance-config-arrows-1"));

        // When
        await user.click(screen.getByTestId("distance-config-total-ends-1"));

        // Then
        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(
          screen.getByTestId("distance-config-total-ends-1-locked-message"),
        ).toBeInTheDocument();
      });

      it("距離とMarked/Unmarkedを押してもメッセージは表示されない", async () => {
        // Given
        const user = userEvent.setup();
        setup({ hasShots: true, roundFormat: "field" });

        // When
        await user.click(screen.getByTestId("distance-config-distance-1"));
        await user.click(screen.getByTestId("distance-config-marked-1"));

        // Then
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });

      it("的選択トリガーのラベルに変更不可の理由を示す", () => {
        // Given
        // When
        setup({ hasShots: true });

        // Then
        expect(
          screen.getByLabelText(
            `${targetFaceOutdoorRecurve.name}（スコア記録済みのため変更不可）`,
          ),
        ).toBeInTheDocument();
      });

      it("選択中の的が存在しなければ、ラベルは「的（スコア記録済みのため変更不可）」になる", () => {
        // Given
        // When
        setup({
          hasShots: true,
          distance: { ...baseDistance, targetFaceId: "unknown-face" },
        });

        // Then
        expect(
          screen.getByLabelText("的（スコア記録済みのため変更不可）"),
        ).toBeInTheDocument();
      });
    });

    describe("選択中の的が一覧に存在しない場合", () => {
      const props = {
        distance: { ...baseDistance, targetFaceId: "unknown-face" },
      };

      it("選択中の的が一覧に無ければ、トリガーは「的データを取得できません」の表示とラベルになり、操作不可にならない", () => {
        // Given
        // When
        setup(props);

        // Then
        const trigger = screen.getByLabelText(
          "的データを取得できません（タップで変更）",
        );
        expect(trigger).toHaveTextContent("的データを取得できません");
        expect(trigger).not.toHaveAttribute("aria-disabled");
      });

      it("選択中の的が一覧に無くても、トリガーを押すと一覧から選び直せる", async () => {
        // Given
        const user = userEvent.setup();
        setup(props);

        // When
        await user.click(
          screen.getByLabelText("的データを取得できません（タップで変更）"),
        );

        // Then
        expect(
          screen.getByTestId(
            `target-face-option-${targetFaceOutdoorRecurve.id}`,
          ),
        ).toBeInTheDocument();
      });

      it("スコア記録済みなら、トリガーは操作不可になる", () => {
        // Given
        // When
        setup({ ...props, hasShots: true });

        // Then
        expect(
          screen.getByLabelText("的（スコア記録済みのため変更不可）"),
        ).toHaveAttribute("aria-disabled", "true");
      });
    });
  });

  describe("保存", () => {
    describe("入力内容が有効な場合", () => {
      it("onSavedとenqueueを検証済みの距離設定で呼ぶ", async () => {
        // Given
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
          "12",
        );

        // When
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then
        expect(onSaved).toHaveBeenCalledWith({
          id: "distance-1",
          distanceNumber: 1,
          distance: 50,
          totalEnds: 12,
          arrowsPerEnd: 3,
          targetFaceId: "face-outdoor-recurve",
          isMarked: true,
        });
        expect(enqueue).toHaveBeenCalledWith({
          type: "distance.updated",
          eventId: EVENT_ID,
          distanceId: "distance-1",
          changes: {
            distance: 50,
            config: {
              totalEnds: 12,
              arrowsPerEnd: 3,
              targetFaceId: "face-outdoor-recurve",
            },
          },
        });
      });
    });

    describe("変更がない場合", () => {
      it("onSavedは呼ぶが、enqueueは呼ばない", async () => {
        // Given
        const user = userEvent.setup();
        const { onSaved, enqueue } = setup();

        // When
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then
        expect(onSaved).toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      });
    });

    describe("開いている間にdistanceが変わった場合", () => {
      it("開いている間にdistanceが変わっても、下書きを書き換えない", async () => {
        // Given
        const user = userEvent.setup();
        const { enqueue, rerender, ...props } = setup();
        await user.clear(screen.getByTestId("distance-config-distance-1"));
        await user.type(screen.getByTestId("distance-config-distance-1"), "50");

        // When
        const element = (distance: DistanceConfig) => (
          <DistanceEditFields
            distance={distance}
            hasShots={false}
            targetFaces={targetFaces}
            roundFormat="outdoor"
            roundBowType="recurve"
            onSaved={props.onSaved}
            onDeleted={props.onDeleted}
            onOpenChange={props.onOpenChange}
            enqueue={enqueue}
          />
        );
        rerender(element({ ...baseDistance }));
        rerender(element({ ...baseDistance, totalEnds: 12, arrowsPerEnd: 3 }));

        // Then
        expect(screen.getByTestId("distance-config-distance-1")).toHaveValue(
          50,
        );
      });

      it("開いている間に他の端末の変更が届いた後に保存すると、開いたときの値との差だけを送る", async () => {
        // Given
        vi.spyOn(crypto, "randomUUID").mockReturnValue(EVENT_ID);
        const user = userEvent.setup();
        const { enqueue, rerender, ...props } = setup();
        await user.clear(screen.getByTestId("distance-config-distance-1"));
        await user.type(screen.getByTestId("distance-config-distance-1"), "50");
        const element = (distance: DistanceConfig) => (
          <DistanceEditFields
            distance={distance}
            hasShots={false}
            targetFaces={targetFaces}
            roundFormat="outdoor"
            roundBowType="recurve"
            onSaved={props.onSaved}
            onDeleted={props.onDeleted}
            onOpenChange={props.onOpenChange}
            enqueue={enqueue}
          />
        );
        rerender(element({ ...baseDistance }));
        rerender(element({ ...baseDistance, totalEnds: 12, arrowsPerEnd: 3 }));

        // When
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then
        expect(enqueue).toHaveBeenCalledWith({
          type: "distance.updated",
          eventId: EVENT_ID,
          distanceId: "distance-1",
          changes: { distance: 50 },
        });
      });
    });

    describe("入力内容が無効な場合", () => {
      it("各項目のエラーを表示し、onSavedもenqueueも呼ばない", async () => {
        // Given
        const user = userEvent.setup();
        const { onSaved, enqueue } = setup({ roundFormat: "field" });
        await user.click(screen.getByTestId("distance-config-marked-1"));
        await user.clear(screen.getByTestId("distance-config-distance-1"));
        await user.clear(screen.getByTestId("distance-config-arrows-1"));
        await user.clear(screen.getByTestId("distance-config-total-ends-1"));

        // When
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then
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
        // Given
        vi.spyOn(crypto, "randomUUID").mockReturnValue(EVENT_ID);
        const user = userEvent.setup();
        const { onDeleted, enqueue } = setup({ hasShots: false });

        // When
        await user.click(screen.getByTestId("distance-config-delete-1"));

        // Then
        expect(onDeleted).toHaveBeenCalled();
        expect(enqueue).toHaveBeenCalledWith({
          type: "distance.disabled",
          eventId: EVENT_ID,
          distanceId: "distance-1",
        });
      });
    });

    describe("スコア記録済みの場合", () => {
      it("削除を押すと、確認ダイアログを表示し、まだ削除しない", async () => {
        // Given
        const user = userEvent.setup();
        const { onDeleted } = setup({ hasShots: true });

        // When
        await user.click(screen.getByTestId("distance-config-delete-1"));

        // Then
        expect(
          screen.getByText(
            "この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？",
          ),
        ).toBeInTheDocument();
        expect(onDeleted).not.toHaveBeenCalled();
      });

      it("確認ダイアログで確認すると、削除を通知し、同期操作を登録する", async () => {
        // Given
        const user = userEvent.setup();
        const { onDeleted, enqueue } = setup({ hasShots: true });
        await user.click(screen.getByTestId("distance-config-delete-1"));

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
        expect(onDeleted).toHaveBeenCalled();
        expect(enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ type: "distance.disabled" }),
        );
      });

      it("確認をキャンセルすると削除しない", async () => {
        // Given
        const user = userEvent.setup();
        const { onDeleted, enqueue } = setup({ hasShots: true });
        await user.click(screen.getByTestId("distance-config-delete-1"));

        // When
        await user.click(screen.getByTestId("confirm-dialog-cancel"));

        // Then
        expect(onDeleted).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      });

      it("確認ダイアログの背景を押すと、削除しない", async () => {
        // Given
        const user = userEvent.setup();
        const { onDeleted, enqueue } = setup({ hasShots: true });
        await user.click(screen.getByTestId("distance-config-delete-1"));
        const backdrops = document.querySelectorAll(".bg-black\\/40");

        // When
        await user.click(backdrops[backdrops.length - 1]);

        // Then
        expect(onDeleted).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      });
    });
  });

  describe("Escapeキー", () => {
    it("onOpenChangeをfalseで呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      const { onOpenChange } = setup();

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(onOpenChange).toHaveBeenCalledWith(
        false,
        expect.objectContaining({ reason: "escape-key" }),
      );
    });
  });

  describe("背景のクリック", () => {
    it("距離編集の背景を押すと、閉じるよう通知し、保存しない", async () => {
      // Given
      const user = userEvent.setup();
      const { onOpenChange, onSaved, enqueue } = setup();
      await user.clear(screen.getByTestId("distance-config-distance-1"));
      await user.type(screen.getByTestId("distance-config-distance-1"), "99");
      const backdrops = document.querySelectorAll(".bg-black\\/40");

      // When
      await user.click(backdrops[backdrops.length - 1]);

      // Then
      expect(onOpenChange).toHaveBeenCalledWith(
        false,
        expect.objectContaining({ reason: "outside-press" }),
      );
      expect(onSaved).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("的選択の背景を押すと、的選択だけが閉じ、距離編集は開いたまま", async () => {
      // Given
      const user = userEvent.setup();
      const { onOpenChange } = setup();
      await user.click(screen.getByTestId("target-face-picker-trigger"));
      expect(
        screen.getByTestId(`target-face-option-${targetFaceOutdoorRecurve.id}`),
      ).toBeInTheDocument();
      const backdrops = document.querySelectorAll(".bg-black\\/40");

      // When
      await user.click(backdrops[backdrops.length - 1]);

      // Then
      expect(
        screen.queryByTestId(
          `target-face-option-${targetFaceOutdoorRecurve.id}`,
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("distance-config-distance-1"),
      ).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  describe("的選択ポップアップ", () => {
    describe("開いた直後", () => {
      it("ラウンドの種別・弓種で絞り込んだ的を表示する", async () => {
        // Given
        const user = userEvent.setup();
        setup();

        // When
        await user.click(screen.getByTestId("target-face-picker-trigger"));

        // Then
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
        // Given
        const user = userEvent.setup();
        setup();
        await user.click(screen.getByTestId("target-face-picker-trigger"));

        // When
        await user.click(screen.getByTestId("target-face-format-tab-all"));
        await user.click(screen.getByTestId("target-face-bow-type-tab-all"));

        // Then
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

    describe("種別タブの切り替え", () => {
      it("選んだ種別・弓種に対応する的だけを表示する", async () => {
        // Given
        const user = userEvent.setup();
        const targetFaceField: TargetFaceOption = {
          id: "face-field-recurve",
          name: "フィールド的",
          size: 80,
          format: "field",
          bow_type: ["recurve"],
          target_face_spots: [],
        };
        setup({ targetFaces: [...targetFaces, targetFaceField] });
        await user.click(screen.getByTestId("target-face-picker-trigger"));

        // When
        await user.click(screen.getByTestId("target-face-format-tab-field"));

        // Then
        expect(
          screen.getByTestId(`target-face-option-${targetFaceField.id}`),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId(
            `target-face-option-${targetFaceOutdoorRecurve.id}`,
          ),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId(
            `target-face-option-${targetFaceIndoorCompound.id}`,
          ),
        ).not.toBeInTheDocument();
      });
    });

    describe("的の選択", () => {
      it("的を選ぶと、ポップアップが閉じる", async () => {
        // Given
        const user = userEvent.setup();
        setup();
        await user.click(screen.getByTestId("target-face-picker-trigger"));
        await user.click(screen.getByTestId("target-face-format-tab-all"));
        await user.click(screen.getByTestId("target-face-bow-type-tab-all"));

        // When
        await user.click(
          screen.getByTestId(
            `target-face-option-${targetFaceIndoorCompound.id}`,
          ),
        );

        // Then
        expect(
          screen.queryByTestId(
            `target-face-option-${targetFaceIndoorCompound.id}`,
          ),
        ).not.toBeInTheDocument();
      });

      it("的を選んで保存すると、選んだ的で同期操作を登録する", async () => {
        // Given
        const user = userEvent.setup();
        const { enqueue } = setup();
        await user.click(screen.getByTestId("target-face-picker-trigger"));
        await user.click(screen.getByTestId("target-face-format-tab-all"));
        await user.click(screen.getByTestId("target-face-bow-type-tab-all"));
        await user.click(
          screen.getByTestId(
            `target-face-option-${targetFaceIndoorCompound.id}`,
          ),
        );

        // When
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then
        expect(enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            changes: {
              config: {
                totalEnds: 6,
                arrowsPerEnd: 6,
                targetFaceId: targetFaceIndoorCompound.id,
              },
            },
          }),
        );
      });
    });

    describe("一覧の並べ方", () => {
      it("一覧は、絞り込んだ的を並び順で並べ、選択中の的を押された状態で示す", async () => {
        // Given
        const user = userEvent.setup();
        setup();
        await user.click(screen.getByTestId("target-face-picker-trigger"));

        // When
        await user.click(screen.getByTestId("target-face-format-tab-all"));
        await user.click(screen.getByTestId("target-face-bow-type-tab-all"));

        // Then
        const items = screen.getAllByTestId(/^target-face-option-/);
        expect(items.map((i) => i.getAttribute("aria-label"))).toEqual(
          targetFaces.map((f) => f.name),
        );
        for (const item of items) {
          expect(item.tagName).toBe("BUTTON");
        }
        expect(items[0]).toHaveAttribute("aria-pressed", "true");
        expect(items[1]).toHaveAttribute("aria-pressed", "false");
      });
    });
  });

  describe("入力欄のEnterキー", () => {
    it("距離の入力欄でEnterを押しても、保存も閉鎖も同期操作の登録もしない", async () => {
      // Given
      const user = userEvent.setup();
      const { onSaved, onOpenChange, enqueue } = setup();
      const input = screen.getByTestId("distance-config-distance-1");
      await user.click(input);

      // When
      await user.keyboard("{Enter}");

      // Then
      expect(onSaved).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });
});

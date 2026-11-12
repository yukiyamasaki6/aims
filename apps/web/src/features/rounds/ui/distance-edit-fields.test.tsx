import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TargetFaceOption } from "@/features/rounds/domain/target-face";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { DISTANCE_LIMITS } from "../domain/round-constants";
import type { Distance, Shot } from "../domain/scorecard-types";
import { DistanceEditFields } from "./distance-edit-fields";
import { createFakeRoundProcedures } from "./round-stores-test-helpers";
import { RoundProceduresProvider } from "./rounds-context";

// 輪を1つだけ持つ的。的の表示は輪を持つ的を前提にする。
const SINGLE_RING_SPOTS = [
  {
    center_x: 0,
    center_y: 0,
    target_face_rings: [
      {
        radius: 1,
        color: "#FFFFFF",
        line_color: null,
        z_index: 1,
        score_str: "M",
        score_int: 0,
      },
    ],
  },
];

const roundsText = translatorFor("rounds");

const targetFaceOutdoorRecurve: TargetFaceOption = {
  id: "face-outdoor-recurve",
  name: "10点的アウトドア",
  size: 122,
  format: "outdoor",
  bow_type: ["recurve", "compound"],
  target_face_spots: SINGLE_RING_SPOTS,
};

const targetFaceIndoorCompound: TargetFaceOption = {
  id: "face-indoor-compound",
  name: "5点的インドア",
  size: 40,
  format: "indoor",
  bow_type: ["compound"],
  target_face_spots: SINGLE_RING_SPOTS,
};

const targetFaces = [targetFaceOutdoorRecurve, targetFaceIndoorCompound];

const baseDistance: Distance = {
  id: "distance-1",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: targetFaceOutdoorRecurve.id,
  is_marked: true,
};

// 6エンド×6射の距離の、エンド3に3本が記録されている(記録済みの最大のエンドは3、1エンドの最大の矢数は3)。
const recordedShots: Shot[] = [1, 2, 3].map((n) => ({
  id: `shot-${n}`,
  distance_id: "distance-1",
  end_number: 3,
  score_str: "M",
  score_int: 0,
  shot_number: null,
}));

const EVENT_ID = "00000000-0000-4000-8000-000000000001";

function setup(
  overrides: Partial<Parameters<typeof DistanceEditFields>[0]> = {},
) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const onOpenChange = vi.fn();
  const enqueue = vi.fn();
  const procedures = createFakeRoundProcedures();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <IntlTestProvider>
      <RoundProceduresProvider procedures={procedures}>
        {children}
      </RoundProceduresProvider>
    </IntlTestProvider>
  );
  const utils = render(
    <DistanceEditFields
      distance={baseDistance}
      displayNumber={1}
      shots={[]}
      targetFaces={targetFaces}
      roundFormat="outdoor"
      roundBowType="recurve"
      onSaved={onSaved}
      onDeleted={onDeleted}
      onOpenChange={onOpenChange}
      enqueue={enqueue}
      {...overrides}
    />,
    { wrapper },
  );
  return { onSaved, onDeleted, onOpenChange, enqueue, procedures, ...utils };
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

    describe("スコアが記録済みの場合", () => {
      it("的が編集不可になり、本数・エンド数・距離は編集できる", () => {
        // Given
        // When
        setup({ shots: recordedShots });

        // Then
        expect(
          screen.getByTestId("target-face-picker-trigger"),
        ).toHaveAttribute("aria-disabled", "true");
        for (const testId of [
          "distance-config-arrows-1",
          "distance-config-total-ends-1",
          "distance-config-distance-1",
        ]) {
          expect(screen.getByTestId(testId)).not.toHaveAttribute("readonly");
        }
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });

      it("的を押すとメッセージが表示され、的選択ダイアログは開かない", async () => {
        // Given
        const user = userEvent.setup();
        const { onSaved } = setup({ shots: recordedShots });

        // When
        await user.click(screen.getByTestId("target-face-picker-trigger"));

        // Then
        expect(
          screen.getByTestId("distance-config-target-face-locked-message"),
        ).toHaveTextContent(roundsText("distanceLocked"));
        expect(
          screen.queryByTestId(
            `target-face-option-${targetFaceOutdoorRecurve.id}`,
          ),
        ).not.toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
      });

      it("距離・本数・エンド数・Marked/Unmarkedを押してもメッセージは表示されない", async () => {
        // Given
        const user = userEvent.setup();
        setup({ shots: recordedShots, roundFormat: "field" });

        // When
        await user.click(screen.getByTestId("distance-config-distance-1"));
        await user.click(screen.getByTestId("distance-config-arrows-1"));
        await user.click(screen.getByTestId("distance-config-total-ends-1"));
        await user.click(screen.getByTestId("distance-config-marked-1"));

        // Then
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });

      it("的選択トリガーのラベルに変更不可の理由を示す", () => {
        // Given
        // When
        setup({ shots: recordedShots });

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
          shots: recordedShots,
          distance: { ...baseDistance, target_face_id: "unknown-face" },
        });

        // Then
        expect(
          screen.getByLabelText(
            roundsText("targetFaceTriggerLocked", { name: "的" }),
          ),
        ).toBeInTheDocument();
      });
    });

    describe("選択中の的が一覧に存在しない場合", () => {
      const props = {
        distance: { ...baseDistance, target_face_id: "unknown-face" },
      };

      it("選択中の的が一覧に無ければ、トリガーは「的データを取得できません」の表示とラベルになり、操作不可にならない", () => {
        // Given
        // When
        setup(props);

        // Then
        const trigger = screen.getByLabelText(
          roundsText("targetFaceTriggerMissing"),
        );
        expect(trigger).toHaveTextContent(roundsText("targetFaceMissing"));
        expect(trigger).not.toHaveAttribute("aria-disabled");
      });

      it("選択中の的が一覧に無くても、トリガーを押すと一覧から選び直せる", async () => {
        // Given
        const user = userEvent.setup();
        setup(props);

        // When
        await user.click(
          screen.getByLabelText(roundsText("targetFaceTriggerMissing")),
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
        setup({ ...props, shots: recordedShots });

        // Then
        expect(
          screen.getByLabelText(
            roundsText("targetFaceTriggerLocked", { name: "的" }),
          ),
        ).toHaveAttribute("aria-disabled", "true");
      });
    });
  });

  describe("保存", () => {
    describe("入力内容が有効な場合", () => {
      it("onSavedとenqueueを検証済みの距離設定で呼ぶ", async () => {
        // Given
        const user = userEvent.setup();
        const { onSaved, enqueue, procedures } = setup();
        procedures.ids.next.mockReturnValue(EVENT_ID);
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
          position_key: "a",
          distance: 50,
          total_ends: 12,
          arrows_per_end: 3,
          target_face_id: "face-outdoor-recurve",
          is_marked: true,
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
        const { onSaved, enqueue, procedures } = setup();
        procedures.ids.next.mockReturnValue(EVENT_ID);

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
        const element = (distance: Distance) => (
          <DistanceEditFields
            distance={distance}
            displayNumber={1}
            shots={[]}
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
        rerender(
          element({ ...baseDistance, total_ends: 12, arrows_per_end: 3 }),
        );

        // Then
        expect(screen.getByTestId("distance-config-distance-1")).toHaveValue(
          50,
        );
      });

      it("開いている間に他の端末の変更が届いた後に保存すると、開いたときの値との差だけを送る", async () => {
        // Given
        const user = userEvent.setup();
        const { enqueue, rerender, procedures, ...props } = setup();
        procedures.ids.next.mockReturnValue(EVENT_ID);
        await user.clear(screen.getByTestId("distance-config-distance-1"));
        await user.type(screen.getByTestId("distance-config-distance-1"), "50");
        const element = (distance: Distance) => (
          <DistanceEditFields
            distance={distance}
            displayNumber={1}
            shots={[]}
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
        rerender(
          element({ ...baseDistance, total_ends: 12, arrows_per_end: 3 }),
        );

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
          screen.getByText(roundsText("distanceConfigError.required")),
        ).toBeInTheDocument();
        expect(
          screen.getAllByText("1以上の整数を入力してください。"),
        ).toHaveLength(2);
        expect(onSaved).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      });
    });
  });

  describe("範囲外の値", () => {
    it.each([
      ["距離(m)", "distance-config-distance-1", "0", DISTANCE_LIMITS.distance],
      ["本数", "distance-config-arrows-1", "-1", DISTANCE_LIMITS.arrowsPerEnd],
      [
        "総エンド数",
        "distance-config-total-ends-1",
        "2.5",
        DISTANCE_LIMITS.totalEnds,
      ],
    ])(
      "%sが1以上の整数でないと、保存せずに項目の下に理由を出し、上限の理由は出さない",
      async (_label, testId, value, max) => {
        // Given
        const user = userEvent.setup();
        const { onSaved, enqueue } = setup();
        await user.clear(screen.getByTestId(testId));
        await user.type(screen.getByTestId(testId), value);

        // When
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then
        expect(
          screen.getByText(
            roundsText("distanceConfigError.notPositiveInteger"),
          ),
        ).toBeInTheDocument();
        expect(
          screen.queryByText(
            roundsText("distanceConfigError.tooLarge", { max: String(max) }),
          ),
        ).not.toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      },
    );
  });

  describe("上限", () => {
    it.each([
      ["距離(m)", "distance-config-distance-1", DISTANCE_LIMITS.distance],
      ["本数", "distance-config-arrows-1", DISTANCE_LIMITS.arrowsPerEnd],
      ["総エンド数", "distance-config-total-ends-1", DISTANCE_LIMITS.totalEnds],
    ])(
      "%sが上限を超えると、その項目の上限を示す理由を出し、保存せず入力も残す",
      async (_label, testId, max) => {
        // Given
        const user = userEvent.setup();
        const { onSaved, enqueue } = setup();
        await user.clear(screen.getByTestId(testId));
        // 値そのものが検証の対象のため、実際にない大きさの値を使う。
        await user.type(screen.getByTestId(testId), String(max + 1));

        // When
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then
        expect(
          screen.getByText(
            roundsText("distanceConfigError.tooLarge", { max: String(max) }),
          ),
        ).toBeInTheDocument();
        expect(screen.getByTestId(testId)).toHaveValue(max + 1);
        expect(onSaved).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        "距離(m)",
        "distance-config-distance-1",
        "distance",
        DISTANCE_LIMITS.distance,
      ],
      [
        "本数",
        "distance-config-arrows-1",
        "arrows_per_end",
        DISTANCE_LIMITS.arrowsPerEnd,
      ],
      [
        "総エンド数",
        "distance-config-total-ends-1",
        "total_ends",
        DISTANCE_LIMITS.totalEnds,
      ],
    ])(
      "%sが上限ちょうどなら、保存できる",
      async (_label, testId, field, max) => {
        // Given
        const user = userEvent.setup();
        const { onSaved, enqueue, procedures } = setup();
        procedures.ids.next.mockReturnValue(EVENT_ID);
        await user.clear(screen.getByTestId(testId));
        // 値そのものが検証の対象のため、実際にない大きさの値を使う。
        await user.type(screen.getByTestId(testId), String(max));

        // When
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then
        expect(onSaved).toHaveBeenCalledWith(
          expect.objectContaining({ [field]: max }),
        );
        expect(enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ type: "distance.updated" }),
        );
        expect(
          screen.queryByText(
            roundsText("distanceConfigError.tooLarge", { max: String(max) }),
          ),
        ).not.toBeInTheDocument();
      },
    );

    it("上限を超えた後に上限ちょうどへ直して保存すると、理由が消えて保存できる", async () => {
      // Given
      const user = userEvent.setup();
      const { onSaved, procedures } = setup();
      procedures.ids.next.mockReturnValue(EVENT_ID);
      const input = screen.getByTestId("distance-config-total-ends-1");
      await user.clear(input);
      // 値そのものが検証の対象のため、実際にない大きさの値を使う。
      await user.type(input, String(DISTANCE_LIMITS.totalEnds + 1));
      await user.click(screen.getByTestId("distance-config-save-1"));
      const message = roundsText("distanceConfigError.tooLarge", {
        max: String(DISTANCE_LIMITS.totalEnds),
      });
      expect(screen.getByText(message)).toBeInTheDocument();
      await user.clear(input);
      await user.type(input, String(DISTANCE_LIMITS.totalEnds));

      // When
      await user.click(screen.getByTestId("distance-config-save-1"));

      // Then
      expect(screen.queryByText(message)).not.toBeInTheDocument();
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ total_ends: DISTANCE_LIMITS.totalEnds }),
      );
    });

    it("複数の項目が上限を超えると、超えた項目それぞれの下に、その項目の上限を示す理由を出す", async () => {
      // Given
      const user = userEvent.setup();
      const { onSaved, enqueue } = setup();
      const limits = [
        ["distance-config-distance-1", DISTANCE_LIMITS.distance],
        ["distance-config-arrows-1", DISTANCE_LIMITS.arrowsPerEnd],
        ["distance-config-total-ends-1", DISTANCE_LIMITS.totalEnds],
      ] as const;
      for (const [testId, max] of limits) {
        await user.clear(screen.getByTestId(testId));
        // 値そのものが検証の対象のため、実際にない大きさの値を使う。
        await user.type(screen.getByTestId(testId), String(max + 1));
      }

      // When
      await user.click(screen.getByTestId("distance-config-save-1"));

      // Then
      for (const max of [
        DISTANCE_LIMITS.distance,
        DISTANCE_LIMITS.totalEnds,
        DISTANCE_LIMITS.arrowsPerEnd,
      ]) {
        expect(
          screen.getByText(
            roundsText("distanceConfigError.tooLarge", { max: String(max) }),
          ),
        ).toBeInTheDocument();
      }
      expect(onSaved).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe("スコア記録済みの距離の総エンド数・本数", () => {
    async function save(
      user: ReturnType<typeof userEvent.setup>,
      totalEnds: string,
      arrows: string,
    ) {
      await user.clear(screen.getByTestId("distance-config-total-ends-1"));
      await user.type(
        screen.getByTestId("distance-config-total-ends-1"),
        totalEnds,
      );
      await user.clear(screen.getByTestId("distance-config-arrows-1"));
      await user.type(screen.getByTestId("distance-config-arrows-1"), arrows);
      await user.click(screen.getByTestId("distance-config-save-1"));
    }

    it("記録済みの最大のエンド・矢数と同じ値まで減らす保存はできる", async () => {
      // Given
      const user = userEvent.setup();
      const { onSaved, enqueue, procedures } = setup({ shots: recordedShots });
      procedures.ids.next.mockReturnValue(EVENT_ID);

      // When
      await save(user, "3", "3");

      // Then
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ total_ends: 3, arrows_per_end: 3 }),
      );
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            config: {
              totalEnds: 3,
              arrowsPerEnd: 3,
              targetFaceId: "face-outdoor-recurve",
            },
          },
        }),
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("記録済みの矢が収まらない値は、総エンド数の下に理由を出し、保存せず入力も残す。本数からも理由を参照する", async () => {
      // Given
      const user = userEvent.setup();
      const { onSaved, enqueue } = setup({ shots: recordedShots });

      // When
      await save(user, "2", "2");

      // Then
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(
        roundsText("distanceConfigError.shotsUnfit"),
      );
      expect(
        screen.getByTestId("distance-config-total-ends-1"),
      ).toHaveAttribute("aria-describedby", alert.id);
      expect(screen.getByTestId("distance-config-arrows-1")).toHaveAttribute(
        "aria-describedby",
        alert.id,
      );
      expect(screen.getByTestId("distance-config-total-ends-1")).toHaveValue(2);
      expect(screen.getByTestId("distance-config-total-ends-1")).toBeInvalid();
      expect(screen.getByTestId("distance-config-arrows-1")).toBeInvalid();
      expect(onSaved).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("収まらない値の後に収まる値で保存すると、理由が消える", async () => {
      // Given
      const user = userEvent.setup();
      const { onSaved } = setup({ shots: recordedShots });
      await save(user, "2", "6");
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // When
      await save(user, "3", "6");

      // Then
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onSaved).toHaveBeenCalled();
    });
  });

  describe("削除", () => {
    describe("スコア未記録の場合", () => {
      it("確認なしにonDeletedとenqueueを呼ぶ", async () => {
        // Given
        const user = userEvent.setup();
        const { onDeleted, enqueue, procedures } = setup({ shots: [] });
        procedures.ids.next.mockReturnValue(EVENT_ID);

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
        const { onDeleted } = setup({ shots: recordedShots });

        // When
        await user.click(screen.getByTestId("distance-config-delete-1"));

        // Then
        expect(
          screen.getByText(roundsText("distanceDeleteConfirm")),
        ).toBeInTheDocument();
        expect(onDeleted).not.toHaveBeenCalled();
      });

      it("確認ダイアログで確認すると、削除を通知し、同期操作を登録する", async () => {
        // Given
        const user = userEvent.setup();
        const { onDeleted, enqueue } = setup({ shots: recordedShots });
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
        const { onDeleted, enqueue } = setup({ shots: recordedShots });
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
        const { onDeleted, enqueue } = setup({ shots: recordedShots });
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
          target_face_spots: SINGLE_RING_SPOTS,
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

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

    describe("入力欄の並び", () => {
      function expectDomOrder(elements: HTMLElement[]) {
        for (let i = 0; i < elements.length - 1; i++) {
          expect(
            elements[i].compareDocumentPosition(elements[i + 1]) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
        }
      }

      it("フィールドでは、Marked切り替え、距離、本数、エンド数、的の順に並ぶ", () => {
        // Given: フィールドのラウンド
        // When: 表示する
        setup({ roundFormat: "field" });

        // Then: 上から順に並ぶ
        expectDomOrder([
          screen.getByTestId("distance-config-marked-1"),
          screen.getByLabelText("距離（m）"),
          screen.getByLabelText("エンドあたりの本数"),
          screen.getByLabelText("総エンド数"),
          screen.getByTestId("target-face-picker-trigger"),
        ]);
      });

      it("フィールド以外では、切り替えが無く、距離、本数、エンド数、的の順に並ぶ", () => {
        // Given: アウトドアのラウンド
        // When: 表示する
        setup({ roundFormat: "outdoor" });

        // Then: 切り替えが無く、上から順に並ぶ
        expect(
          screen.queryByTestId("distance-config-marked-1"),
        ).not.toBeInTheDocument();
        expectDomOrder([
          screen.getByLabelText("距離（m）"),
          screen.getByLabelText("エンドあたりの本数"),
          screen.getByLabelText("総エンド数"),
          screen.getByTestId("target-face-picker-trigger"),
        ]);
      });
    });

    describe("hasShotsがtrueの場合", () => {
      it("的・本数・エンド数が編集不可になる（距離は編集可能）", () => {
        // Given: スコア記録済みの距離
        const props = { hasShots: true };

        // When: 表示する
        setup(props);

        // Then: 距離以外は読み取り専用、的は操作不可を示す
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
          // Given: スコア記録済みの距離
          const user = userEvent.setup();
          const { onSaved } = setup({ hasShots: true });
          const input = screen.getByTestId(testId);
          const before = (input as HTMLInputElement).value;

          // When: 押して入力を試みる
          await user.click(input);
          await user.type(input, "9");

          // Then: 理由が表示され、値は変わらない
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
        // Given: スコア記録済みの距離
        const user = userEvent.setup();
        const { onSaved } = setup({ hasShots: true });

        // When: 的を押す
        await user.click(screen.getByTestId("target-face-picker-trigger"));

        // Then: 理由が表示され、一覧は開かない
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
        // Given: 本数を押してメッセージが出ている
        const user = userEvent.setup();
        setup({ hasShots: true });
        await user.click(screen.getByTestId("distance-config-arrows-1"));

        // When: 総エンド数を押す
        await user.click(screen.getByTestId("distance-config-total-ends-1"));

        // Then: メッセージは1つで、総エンド数の直下にある
        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(
          screen.getByTestId("distance-config-total-ends-1-locked-message"),
        ).toBeInTheDocument();
      });

      it("距離とMarked/Unmarkedを押してもメッセージは表示されない", async () => {
        // Given: スコア記録済みのフィールドの距離
        const user = userEvent.setup();
        setup({ hasShots: true, roundFormat: "field" });

        // When: 距離とMarkedを押す
        await user.click(screen.getByTestId("distance-config-distance-1"));
        await user.click(screen.getByTestId("distance-config-marked-1"));

        // Then: メッセージは出ない
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

    describe("選択中の的が一覧に存在しない場合", () => {
      const props = {
        distance: { ...baseDistance, targetFaceId: "unknown-face" },
      };

      it("的選択トリガーは「的データを取得できません」の表示とラベルになり、開ける", async () => {
        // Given: 存在しない的を選んだ距離
        const user = userEvent.setup();
        setup(props);

        // When: トリガーを開く
        const trigger = screen.getByLabelText(
          "的データを取得できません（タップで変更）",
        );
        expect(trigger).toHaveTextContent("的データを取得できません");
        expect(trigger).not.toHaveAttribute("aria-disabled");
        await user.click(trigger);

        // Then: 一覧から的を選び直せる
        expect(
          screen.getByTestId(
            `target-face-option-${targetFaceOutdoorRecurve.id}`,
          ),
        ).toBeInTheDocument();
      });

      it("スコア記録済みなら、トリガーは操作不可になる", () => {
        setup({ ...props, hasShots: true });

        expect(
          screen.getByLabelText("的（スコア記録済みのため変更不可）"),
        ).toHaveAttribute("aria-disabled", "true");
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
          type: "distance.updated",
          eventId: EVENT_ID,
          distanceId: "distance-1",
          changes: {
            distance: 50,
            config: {
              totalEnds: 10,
              arrowsPerEnd: 3,
              targetFaceId: "face-outdoor-recurve",
            },
          },
        });
      });
    });

    describe("変更がない場合", () => {
      it("onSavedは呼ぶが、enqueueは呼ばない", async () => {
        // Given: 何も編集しないフォーム
        const user = userEvent.setup();
        const { onSaved, enqueue } = setup();

        // When: 保存する
        await user.click(screen.getByTestId("distance-config-save-1"));

        // Then: 同期操作を登録しない
        expect(onSaved).toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
      });
    });

    describe("開いている間にdistanceが変わった場合", () => {
      it("下書きを書き換えず、保存は開いたときの値との差だけを送る", async () => {
        // Given: 距離を編集しているフォーム
        vi.spyOn(crypto, "randomUUID").mockReturnValue(EVENT_ID);
        const user = userEvent.setup();
        const { enqueue, rerender, ...props } = setup();
        await user.clear(screen.getByTestId("distance-config-distance-1"));
        await user.type(screen.getByTestId("distance-config-distance-1"), "50");

        // When: 同じ内容の別の参照、続けて他の端末で本数が変わった内容が届く
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
        rerender(element({ ...baseDistance, arrowsPerEnd: 3 }));

        // Then: 下書きは残り、保存は変えた距離だけを送る
        expect(screen.getByTestId("distance-config-distance-1")).toHaveValue(
          50,
        );
        await user.click(screen.getByTestId("distance-config-save-1"));
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
          type: "distance.disabled",
          eventId: EVENT_ID,
          distanceId: "distance-1",
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
          expect.objectContaining({ type: "distance.disabled" }),
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

    describe("種別タブの切り替え", () => {
      it("選んだ種別・弓種に対応する的だけを表示する", async () => {
        // Given: アウトドア・リカーブのラウンドで、フィールドの的も持つ的選択ポップアップ
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

        // When: 種別タブをフィールドに切り替える
        await user.click(screen.getByTestId("target-face-format-tab-field"));

        // Then: フィールドで、選択中の弓種に対応する的だけを表示する
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
      it("項目は、最小幅から列の数を決める格子に、DOM順・属性を保って並び、項目の中身は左右中央に置かれる", async () => {
        // Given: 的選択ポップアップで全件を表示した状態(選択中はアウトドアの的)
        const user = userEvent.setup();
        setup();
        await user.click(screen.getByTestId("target-face-picker-trigger"));
        await user.click(screen.getByTestId("target-face-format-tab-all"));
        await user.click(screen.getByTestId("target-face-bow-type-tab-all"));

        // When
        const items = screen.getAllByTestId(/^target-face-option-/);

        // Then: 一覧は自動の列数の格子で、項目は中央寄せ。DOM順と属性は保たれる
        const list = items[0].parentElement as HTMLElement;
        expect(list).toHaveClass(
          "grid",
          "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]",
          "overflow-y-auto",
        );
        expect(items.map((i) => i.getAttribute("aria-label"))).toEqual(
          targetFaces.map((f) => f.name),
        );
        for (const item of items) {
          expect(item.tagName).toBe("BUTTON");
          expect(item).toHaveClass("justify-center");
        }
        expect(items[0]).toHaveAttribute("aria-pressed", "true");
        expect(items[1]).toHaveAttribute("aria-pressed", "false");
        expect(items[0]).toHaveClass("bg-muted", "ring-1", "ring-primary");
      });
    });
  });

  describe("入力欄のEnterキー", () => {
    it("距離の入力欄でフォーカスを外すだけで、保存も閉鎖もしない", async () => {
      // Given: フォーカスのある距離の入力欄
      const user = userEvent.setup();
      const { onSaved, onOpenChange, enqueue } = setup();
      const input = screen.getByTestId("distance-config-distance-1");
      await user.click(input);

      // When: Enterを押す
      await user.keyboard("{Enter}");

      // Then: フォーカスが外れ、保存も閉鎖も同期操作の登録もされない
      expect(input).not.toHaveFocus();
      expect(onSaved).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });
  });
});

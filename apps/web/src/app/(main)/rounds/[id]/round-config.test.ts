import { describe, expect, it } from "vitest";
import {
  buildRoundUpdatedInput,
  type RoundConfig,
  validateRoundConfig,
} from "./round-config";

const validDraft: RoundConfig = {
  name: "午前練習",
  roundDate: "2026-09-15",
  format: "outdoor",
  bowType: "recurve",
};

const UNMARKED_ERROR =
  "Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。";

describe("validateRoundConfig", () => {
  describe("すべての項目が有効な場合", () => {
    it("入力内容をそのまま検証済みの設定として返す", () => {
      // Given: 有効な入力内容
      // When: 検証する
      const result = validateRoundConfig(validDraft, false);

      // Then: 入力内容がそのまま検証済みの設定になる
      expect(result).toEqual({
        type: "valid",
        config: {
          name: "午前練習",
          roundDate: "2026-09-15",
          format: "outdoor",
          bowType: "recurve",
        },
      });
    });
  });

  describe("ラウンド名", () => {
    it("50文字までは有効で、51文字からエラーになる", () => {
      // Given: 49・50・51文字のラウンド名
      // When: 検証する
      const results = [49, 50, 51].map(
        (length) =>
          validateRoundConfig(
            { ...validDraft, name: "あ".repeat(length) },
            false,
          ).type,
      );

      // Then: 51文字だけが無効になる
      expect(results).toEqual(["valid", "valid", "invalid"]);
    });

    it("上限を超えるとラウンド名のエラーを返す", () => {
      // Given: 51文字のラウンド名
      // When: 検証する
      const result = validateRoundConfig(
        { ...validDraft, name: "あ".repeat(51) },
        false,
      );

      // Then: ラウンド名のエラーだけを返す
      expect(result).toEqual({
        type: "invalid",
        errors: { name: "ラウンド名は50文字以内で入力してください。" },
      });
    });
  });

  describe("実施日", () => {
    it("空の場合は実施日のエラーを返す", () => {
      // Given: 空の実施日
      // When: 検証する
      const result = validateRoundConfig(
        { ...validDraft, roundDate: "" },
        false,
      );

      // Then: 実施日のエラーだけを返す
      expect(result).toEqual({
        type: "invalid",
        errors: { roundDate: "実施日を入力してください。" },
      });
    });
  });

  describe("種別", () => {
    describe("Unmarkedの距離が残っていない場合", () => {
      it("どの種別にも変更できる", () => {
        // Given: Unmarkedの距離がない状態で、各種別を選んだ入力内容
        // When: 検証する
        const results = ["outdoor", "indoor", "field"].map(
          (format) =>
            validateRoundConfig({ ...validDraft, format }, false).type,
        );

        // Then: すべて有効になる
        expect(results).toEqual(["valid", "valid", "valid"]);
      });
    });

    describe("Unmarkedの距離が残っている場合", () => {
      it("フィールドには変更できる", () => {
        // Given: Unmarkedの距離が残っている状態で、フィールドを選んだ入力内容
        // When: 検証する
        const result = validateRoundConfig(
          { ...validDraft, format: "field" },
          true,
        );

        // Then: 有効になる
        expect(result.type).toBe("valid");
      });

      it("フィールド以外には変更できず、種別のエラーを返す", () => {
        // Given: Unmarkedの距離が残っている状態で、フィールド以外を選んだ入力内容
        // When: 検証する
        const results = ["outdoor", "indoor"].map((format) =>
          validateRoundConfig({ ...validDraft, format }, true),
        );

        // Then: いずれも種別のエラーだけを返す
        expect(results).toEqual([
          { type: "invalid", errors: { format: UNMARKED_ERROR } },
          { type: "invalid", errors: { format: UNMARKED_ERROR } },
        ]);
      });
    });
  });

  describe("複数の項目が無効な場合", () => {
    it("無効な項目すべてのエラーを返す", () => {
      // Given: ラウンド名・実施日・種別がいずれも無効な入力内容
      // When: 検証する
      const result = validateRoundConfig(
        {
          ...validDraft,
          name: "あ".repeat(51),
          roundDate: "",
          format: "indoor",
        },
        true,
      );

      // Then: すべての項目のエラーを返す
      expect(result).toEqual({
        type: "invalid",
        errors: {
          name: "ラウンド名は50文字以内で入力してください。",
          roundDate: "実施日を入力してください。",
          format: UNMARKED_ERROR,
        },
      });
    });
  });
});

describe("buildRoundUpdatedInput", () => {
  it("ラウンド設定の更新操作を、ラウンド設定のキーで登録する入力を作る", () => {
    // Given: ラウンドID・検証済みの設定・イベントID
    // When: 登録内容を作る
    const input = buildRoundUpdatedInput("round-1", validDraft, "event-1");

    // Then: ラウンド設定のキー・ラベルで、round.updatedの操作を持つ
    expect(input).toEqual({
      key: "roundConfig",
      label: "ラウンド設定",
      operation: {
        type: "round.updated",
        eventId: "event-1",
        roundId: "round-1",
        name: "午前練習",
        roundDate: "2026-09-15",
        format: "outdoor",
        bowType: "recurve",
      },
    });
  });
});

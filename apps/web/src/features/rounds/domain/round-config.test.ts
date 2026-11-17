import { describe, expect, it } from "vitest";
import {
  buildRoundUpdatedOperation,
  type RoundConfig,
  validateRoundConfig,
} from "./round-config";

const validDraft: RoundConfig = {
  name: "午前練習",
  roundDate: "2026-09-15",
  format: "outdoor",
  bowType: "recurve",
};

const UNMARKED_ERROR = "unmarkedDistances";

describe("validateRoundConfig", () => {
  describe("すべての項目が有効な場合", () => {
    it("入力内容をそのまま検証済みの設定として返す", () => {
      // Given
      // When
      const result = validateRoundConfig(validDraft, false);

      // Then
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
    it("名前はダイアログで編集しないため検証せず、51文字の名前でも他の項目が有効なら有効で、名前の誤りを返さない", () => {
      // Given
      const draft = { ...validDraft, name: "あ".repeat(51) };

      // When
      const result = validateRoundConfig(draft, false);

      // Then
      expect(result).toEqual({ type: "valid", config: draft });
    });

    it("51文字の名前があっても、他の項目の誤りだけを返し、名前の誤りを含めない", () => {
      // Given
      const draft = { ...validDraft, name: "あ".repeat(51), roundDate: "" };

      // When
      const result = validateRoundConfig(draft, false);

      // Then
      expect(result).toEqual({
        type: "invalid",
        errors: { roundDate: "required" },
      });
    });
  });

  describe("実施日", () => {
    it("空の場合は実施日のエラーを返す", () => {
      // Given
      // When
      const result = validateRoundConfig(
        { ...validDraft, roundDate: "" },
        false,
      );

      // Then
      expect(result).toEqual({
        type: "invalid",
        errors: { roundDate: "required" },
      });
    });
  });

  describe("種別", () => {
    describe("Unmarkedの距離が残っていない場合", () => {
      it("どの種別にも変更できる", () => {
        // Given
        // When
        const results = ["outdoor", "indoor", "field"].map(
          (format) =>
            validateRoundConfig({ ...validDraft, format }, false).type,
        );

        // Then
        expect(results).toEqual(["valid", "valid", "valid"]);
      });
    });

    describe("Unmarkedの距離が残っている場合", () => {
      it("フィールドには変更できる", () => {
        // Given
        // When
        const result = validateRoundConfig(
          { ...validDraft, format: "field" },
          true,
        );

        // Then
        expect(result.type).toBe("valid");
      });

      it("フィールド以外には変更できず、種別のエラーを返す", () => {
        // Given
        // When
        const results = ["outdoor", "indoor"].map((format) =>
          validateRoundConfig({ ...validDraft, format }, true),
        );

        // Then
        expect(results).toEqual([
          { type: "invalid", errors: { format: UNMARKED_ERROR } },
          { type: "invalid", errors: { format: UNMARKED_ERROR } },
        ]);
      });
    });
  });

  describe("複数の項目が無効な場合", () => {
    it("無効な項目すべてのエラーを返す", () => {
      // Given
      // When
      const result = validateRoundConfig(
        {
          ...validDraft,
          roundDate: "",
          format: "indoor",
        },
        true,
      );

      // Then
      expect(result).toEqual({
        type: "invalid",
        errors: {
          roundDate: "required",
          format: UNMARKED_ERROR,
        },
      });
    });
  });
});

describe("buildRoundUpdatedOperation", () => {
  it("保存した値と変えた項目だけを、changesに持つ操作を作る", () => {
    // Given
    // When
    const saved = validDraft;
    const config = { ...validDraft, name: "夜練", format: "indoor" };
    const operation = buildRoundUpdatedOperation(
      "round-1",
      saved,
      config,
      "event-1",
    );

    // Then
    expect(operation).toEqual({
      type: "round.updated",
      eventId: "event-1",
      roundId: "round-1",
      changes: { name: "夜練", format: "indoor" },
    });
  });

  it("実施日と弓種の変更も、changesに持つ", () => {
    // Given
    // When
    const config = {
      ...validDraft,
      roundDate: "2026-10-01",
      bowType: "compound",
    };
    const operation = buildRoundUpdatedOperation(
      "round-1",
      validDraft,
      config,
      "event-1",
    );

    // Then
    expect(operation).toMatchObject({
      changes: { roundDate: "2026-10-01", bowType: "compound" },
    });
  });

  it("変えた項目が無ければ、操作を作らない", () => {
    // Given
    // When
    const operation = buildRoundUpdatedOperation(
      "round-1",
      validDraft,
      { ...validDraft },
      "event-1",
    );

    // Then
    expect(operation).toBeNull();
  });
});

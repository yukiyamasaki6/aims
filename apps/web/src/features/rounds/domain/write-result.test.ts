import { expect, it } from "vitest";
import {
  PRESET_DELETE_ERROR_MESSAGE,
  PRESET_SAVE_ERROR_MESSAGE,
} from "./write-result";

it("プリセットの削除の失敗の文言は「削除できませんでした。」である", () => {
  // Given

  // When
  const message = PRESET_DELETE_ERROR_MESSAGE;

  // Then
  expect(message).toBe("削除できませんでした。");
});

it("プリセットの保存の失敗の文言は「保存できませんでした。」である", () => {
  // Given

  // When
  const message = PRESET_SAVE_ERROR_MESSAGE;

  // Then
  expect(message).toBe("保存できませんでした。");
});

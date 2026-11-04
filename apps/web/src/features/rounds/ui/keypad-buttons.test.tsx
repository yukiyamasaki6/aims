import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Distance } from "@/features/rounds/domain/scorecard-types";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { KeypadButtons } from "./keypad-buttons";
import type { ScoreHistory } from "./use-score-history";
import type { ShotInput } from "./use-shot-input";

const history = {
  canUndo: false,
  canRedo: false,
} as unknown as ScoreHistory;
const input = {
  handleUndo: vi.fn(),
  handleRedo: vi.fn(),
  handleClear: vi.fn(),
  handleScore: vi.fn(),
} as unknown as ShotInput;

describe("KeypadButtons", () => {
  it("指している距離が無いとき、何も表示しない", () => {
    // Given

    // When
    const { container } = render(
      <KeypadButtons
        keypadDistance={null}
        targetFaces={[]}
        pointer={null}
        history={history}
        input={input}
      />,
      { wrapper: IntlTestProvider },
    );

    // Then
    expect(container).toBeEmptyDOMElement();
  });

  it("距離を指しているとき、戻す・進む・クリアのボタンを表示する", () => {
    // Given

    // When
    const distance = { id: "d1", target_face_id: "f1" } as Distance;
    render(
      <KeypadButtons
        keypadDistance={distance}
        targetFaces={[]}
        pointer={null}
        history={history}
        input={input}
      />,
      { wrapper: IntlTestProvider },
    );

    // Then
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
    expect(screen.getByTestId("score-button-clear")).toBeDisabled();
  });
});

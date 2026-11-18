import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { roundCreated } from "../domain/round-op-test-helpers";
import { createFakeRoundWindow } from "./round-stores-test-helpers";
import { RoundWindowProvider } from "./rounds-context";
import { useRoundScreen } from "./use-round-screen";

const ID = "123e4567-e89b-12d3-a456-426614174000";

function setup(roundId: string) {
  const fake = createFakeRoundWindow();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RoundWindowProvider roundWindow={fake.roundWindow}>
      {children}
    </RoundWindowProvider>
  );
  return { fake, ...renderHook(() => useRoundScreen(roundId), { wrapper }) };
}

describe("useRoundScreen", () => {
  it("追記は、画面のラウンドIDの操作として窓口へ渡す", () => {
    // Given
    const { fake, result } = setup(ID);
    const operation = roundCreated();

    // When
    result.current.append(operation);

    // Then
    expect(fake.roundWindow.append).toHaveBeenCalledExactlyOnceWith(
      ID,
      operation,
    );
  });

  it("再試行は、画面のラウンドIDの取得として窓口へ頼む", () => {
    // Given
    const { fake, result } = setup(ID);

    // When
    result.current.retry();

    // Then
    expect(fake.roundWindow.retry).toHaveBeenCalledExactlyOnceWith(ID);
  });
});

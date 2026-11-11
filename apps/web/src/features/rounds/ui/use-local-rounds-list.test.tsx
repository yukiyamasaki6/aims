import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { LocalRoundsList } from "../domain/round-list";
import { createFakeRoundWindow } from "./round-stores-test-helpers";
import { RoundWindowProvider } from "./rounds-context";
import { useLocalRoundsList } from "./use-local-rounds-list";

const roundsText = translatorFor("rounds");

// 端末の記録からの導出と束ねは窓口のテストで確かめるため、窓口は偽で模す。
function setup() {
  const fake = createFakeRoundWindow();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <RoundWindowProvider roundWindow={fake.roundWindow}>
        {children}
      </RoundWindowProvider>
    );
  }
  return { fake, wrapper };
}

const loaded: LocalRoundsList = {
  inProgress: [
    {
      id: "r1",
      name: roundsText("listInProgress"),
      roundDate: "2026-09-15",
      total: 3,
    },
  ],
};

describe("useLocalRoundsList", () => {
  it("読み込みの前はnullを返し、窓口が値を持つと再描画して返す", () => {
    // Given
    const { fake, wrapper } = setup();
    const { result } = renderHook(() => useLocalRoundsList(), { wrapper });
    const before = result.current;

    // When
    act(() => fake.setLocal(loaded));

    // Then
    expect(before).toBeNull();
    expect(result.current).toBe(loaded);
  });

  it("アンマウントすると購読を解除する", () => {
    // Given
    const { fake, wrapper } = setup();
    const { unmount } = renderHook(() => useLocalRoundsList(), { wrapper });
    const stop = fake.roundWindow.watchLocalList.mock.results[0].value;

    // When
    unmount();

    // Then
    expect(fake.roundWindow.watchLocalList).toHaveBeenCalledTimes(1);
    expect(stop).toBeTypeOf("function");
  });

  it("サーバー描画では、窓口に値があってもnullを返す(水和の枠と一致させる)", () => {
    // Given
    const { fake, wrapper: Wrapper } = setup();
    fake.setLocal(loaded);
    function Probe() {
      return (
        <span>{useLocalRoundsList() === null ? "loading" : "loaded"}</span>
      );
    }

    // When
    const html = renderToString(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );

    // Then
    expect(html).toContain("loading");
  });
});

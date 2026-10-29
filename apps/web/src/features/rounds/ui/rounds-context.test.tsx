import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoundsStore } from "../application/rounds-store";
import { RoundsStoreProvider, useRoundsStore } from "./rounds-context";

describe("rounds-context", () => {
  it("提供されたラウンドの状態と変更の方法を、子の部品に返す", () => {
    // Given
    const store = {} as RoundsStore;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RoundsStoreProvider store={store}>{children}</RoundsStoreProvider>
    );

    // When
    const { result } = renderHook(() => useRoundsStore(), { wrapper });

    // Then
    expect(result.current).toBe(store);
  });

  it("提供が無いときは投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Probe() {
      useRoundsStore();
      return <span>描画された</span>;
    }

    // When
    const rendering = () => render(<Probe />);

    // Then
    expect(rendering).toThrow("RoundsStoreProvider");
    expect(screen.queryByText("描画された")).toBeNull();
    vi.restoreAllMocks();
  });
});

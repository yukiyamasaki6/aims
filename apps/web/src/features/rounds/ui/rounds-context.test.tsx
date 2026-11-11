import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoundWindow } from "../application/round-window";
import type { RoundsListStore } from "../application/rounds-list-store";
import {
  type RoundProcedures,
  RoundProceduresProvider,
  RoundsListStoreProvider,
  RoundWindowProvider,
  useRoundProcedures,
  useRoundsListStore,
  useRoundWindow,
} from "./rounds-context";

describe("rounds-context(窓口)", () => {
  it("提供された窓口を、子の部品に返す", () => {
    // Given
    const roundWindow = {} as RoundWindow;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RoundWindowProvider roundWindow={roundWindow}>
        {children}
      </RoundWindowProvider>
    );

    // When
    const { result } = renderHook(() => useRoundWindow(), { wrapper });

    // Then
    expect(result.current).toBe(roundWindow);
  });

  it("提供が無いときは投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Probe() {
      useRoundWindow();
      return <span>描画された</span>;
    }

    // When
    const rendering = () => render(<Probe />);

    // Then
    expect(rendering).toThrow("RoundWindowProvider");
    expect(screen.queryByText("描画された")).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("rounds-context(一覧)", () => {
  it("提供された一覧の窓口を、子の部品に返す", () => {
    // Given
    const store = {} as RoundsListStore;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RoundsListStoreProvider store={store}>
        {children}
      </RoundsListStoreProvider>
    );

    // When
    const { result } = renderHook(() => useRoundsListStore(), { wrapper });

    // Then
    expect(result.current).toBe(store);
  });

  it("提供が無いときは投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Probe() {
      useRoundsListStore();
      return <span>描画された</span>;
    }

    // When
    const rendering = () => render(<Probe />);

    // Then
    expect(rendering).toThrow("RoundsListStoreProvider");
    expect(screen.queryByText("描画された")).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("rounds-context(手続き)", () => {
  it("提供された手続きの入れ物を、子の部品に返す", () => {
    // Given
    const procedures = {} as RoundProcedures;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RoundProceduresProvider procedures={procedures}>
        {children}
      </RoundProceduresProvider>
    );

    // When
    const { result } = renderHook(() => useRoundProcedures(), { wrapper });

    // Then
    expect(result.current).toBe(procedures);
  });

  it("提供が無いときは投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Probe() {
      useRoundProcedures();
      return <span>描画された</span>;
    }

    // When
    const rendering = () => render(<Probe />);

    // Then
    expect(rendering).toThrow("RoundProceduresProvider");
    expect(screen.queryByText("描画された")).toBeNull();
    vi.restoreAllMocks();
  });
});

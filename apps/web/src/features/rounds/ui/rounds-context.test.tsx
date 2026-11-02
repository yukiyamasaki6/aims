import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NewRoundStore } from "../application/new-round-store";
import type { RoundDetailStore } from "../application/round-detail-store";
import type { RoundsListStore } from "../application/rounds-list-store";
import {
  NewRoundStoreProvider,
  RoundDetailStoreProvider,
  RoundsListStoreProvider,
  useNewRoundStore,
  useRoundDetailStore,
  useRoundsListStore,
} from "./rounds-context";

describe("rounds-context(詳細)", () => {
  it("提供されたラウンドの状態と変更の方法を、子の部品に返す", () => {
    // Given
    const store = {} as RoundDetailStore;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RoundDetailStoreProvider store={store}>
        {children}
      </RoundDetailStoreProvider>
    );

    // When
    const { result } = renderHook(() => useRoundDetailStore(), { wrapper });

    // Then
    expect(result.current).toBe(store);
  });

  it("提供が無いときは投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Probe() {
      useRoundDetailStore();
      return <span>描画された</span>;
    }

    // When
    const rendering = () => render(<Probe />);

    // Then
    expect(rendering).toThrow("RoundDetailStoreProvider");
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

describe("rounds-context(作成)", () => {
  it("提供された作成の窓口を、子の部品に返す", () => {
    // Given
    const store = {} as NewRoundStore;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NewRoundStoreProvider store={store}>{children}</NewRoundStoreProvider>
    );

    // When
    const { result } = renderHook(() => useNewRoundStore(), { wrapper });

    // Then
    expect(result.current).toBe(store);
  });

  it("提供が無いときは投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Probe() {
      useNewRoundStore();
      return <span>描画された</span>;
    }

    // When
    const rendering = () => render(<Probe />);

    // Then
    expect(rendering).toThrow("NewRoundStoreProvider");
    expect(screen.queryByText("描画された")).toBeNull();
    vi.restoreAllMocks();
  });
});

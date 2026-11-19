import { render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DeleteAccount } from "../application/delete-account";
import {
  DeleteAccountProvider,
  useDeleteAccount,
} from "./delete-account-context";

describe("DeleteAccountProvider", () => {
  it("提供したアカウント削除の手続きを、子孫のuseDeleteAccountが返す", () => {
    // Given
    const deleteAccount: DeleteAccount = {
      submit: vi.fn(),
      sendCode: vi.fn(),
      verifyCode: vi.fn(),
      tickCooldown: vi.fn(),
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DeleteAccountProvider deleteAccount={deleteAccount}>
        {children}
      </DeleteAccountProvider>
    );

    // When
    const { result } = renderHook(() => useDeleteAccount(), { wrapper });

    // Then
    expect(result.current).toBe(deleteAccount);
  });

  it("子要素を描画する", () => {
    // Given
    const deleteAccount: DeleteAccount = {
      submit: vi.fn(),
      sendCode: vi.fn(),
      verifyCode: vi.fn(),
      tickCooldown: vi.fn(),
    };

    // When
    const { getByText } = render(
      <DeleteAccountProvider deleteAccount={deleteAccount}>
        <p>子要素</p>
      </DeleteAccountProvider>,
    );

    // Then
    expect(getByText("子要素")).toBeInTheDocument();
  });

  it("提供が無いとき、useDeleteAccountは投げる", () => {
    // Given
    vi.spyOn(console, "error").mockImplementation(() => {});

    // When
    const render = () => renderHook(() => useDeleteAccount());

    // Then
    expect(render).toThrow();
  });
});

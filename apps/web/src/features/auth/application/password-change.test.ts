import { describe, expect, it, vi } from "vitest";
import { UNREACHABLE } from "../domain/auth-failure";
import type { CallResult } from "./call-result";
import { createPasswordChange } from "./password-change";

const password = "newPassword123";
const accepted: CallResult = { kind: "accepted" };
const weakPassword: CallResult = {
  kind: "refused",
  failure: { kind: "weak_password" },
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup() {
  const order: string[] = [];
  const authenticator = {
    setPassword: vi.fn(async (_password: string): Promise<CallResult> => {
      order.push("setPassword");
      return accepted;
    }),
    signOutEverywhere: vi.fn(async (): Promise<CallResult> => {
      order.push("signOutEverywhere");
      return accepted;
    }),
  };
  const passwordChange = createPasswordChange({ authenticator });
  return { passwordChange, authenticator, order };
}

describe("パスワードの変更と全端末のサインインの終了(サーバーの手続き)", () => {
  describe("変更に成功した場合", () => {
    it("入力したパスワードで変更し、その後に全端末の終了を1回頼み、変更の成功を返す", async () => {
      // Given
      const { passwordChange, authenticator, order } = setup();

      // When
      const result = await passwordChange.change(password);

      // Then
      expect(result).toEqual(accepted);
      expect(authenticator.setPassword).toHaveBeenCalledExactlyOnceWith(
        password,
      );
      expect(authenticator.signOutEverywhere).toHaveBeenCalledOnce();
      expect(order).toEqual(["setPassword", "signOutEverywhere"]);
    });

    it.each([
      ["拒否", { kind: "refused", failure: { kind: "rate_limited" } } as const],
      ["通信の断の値", { kind: "refused", failure: UNREACHABLE } as const],
      ["未到達", UNREACHABLE],
    ])(
      "終了が%sを返しても、変更の失敗にせず、変更の成功を返す",
      async (_name, signOutResult) => {
        // Given
        const { passwordChange, authenticator } = setup();
        authenticator.signOutEverywhere.mockResolvedValue(signOutResult);

        // When
        const result = await passwordChange.change(password);

        // Then
        expect(result).toEqual(accepted);
        expect(authenticator.signOutEverywhere).toHaveBeenCalledOnce();
      },
    );

    it("終了の応答が来るまでは完了せず、応答の後に変更の成功を返す", async () => {
      // Given
      const { passwordChange, authenticator } = setup();
      const signOut = deferred<CallResult>();
      authenticator.signOutEverywhere.mockReturnValue(signOut.promise);
      let settled = false;
      const pending = passwordChange.change(password).then((result) => {
        settled = true;
        return result;
      });
      await vi.waitFor(() =>
        expect(authenticator.signOutEverywhere).toHaveBeenCalledOnce(),
      );
      await Promise.resolve();
      const beforeResponse = settled;

      // When
      signOut.resolve({ kind: "refused", failure: { kind: "rate_limited" } });
      const result = await pending;

      // Then
      expect(beforeResponse).toBe(false);
      expect(result).toEqual(accepted);
    });
  });

  describe("変更に成功しなかった場合", () => {
    it.each([
      ["拒否", weakPassword],
      ["通信の断の値", { kind: "refused", failure: UNREACHABLE } as const],
      ["未到達", UNREACHABLE],
    ])(
      "変更が%sを返したら、その結果を返し、終了は頼まない",
      async (_name, setResult) => {
        // Given
        const { passwordChange, authenticator } = setup();
        authenticator.setPassword.mockResolvedValue(setResult);

        // When
        const result = await passwordChange.change(password);

        // Then
        expect(result).toEqual(setResult);
        expect(authenticator.signOutEverywhere).not.toHaveBeenCalled();
      },
    );

    it("変更の応答がまだ来ない間は、終了を頼まない", async () => {
      // Given
      const { passwordChange, authenticator } = setup();
      const change = deferred<CallResult>();
      authenticator.setPassword.mockReturnValue(change.promise);

      // When
      void passwordChange.change(password);
      await Promise.resolve();

      // Then
      expect(authenticator.setPassword).toHaveBeenCalledOnce();
      expect(authenticator.signOutEverywhere).not.toHaveBeenCalled();
    });
  });
});

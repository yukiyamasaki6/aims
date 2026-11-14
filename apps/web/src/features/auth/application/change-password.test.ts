import { describe, expect, it } from "vitest";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  type ChangePasswordEvent,
  changePasswordReducer,
  initialChangePasswordFlow,
} from "../domain/change-password-flow";
import type { CallResult } from "./call-result";
import { createChangePassword } from "./change-password";
import { createFakeChangePasswordAuthenticator } from "./change-password-test-helpers";
import { screenHarness } from "./screen-view-test-helpers";

const input = {
  currentPassword: "password-original1",
  newPassword: "password-changed1",
};
const accepted: CallResult = { kind: "accepted" };

function setup(offline = false) {
  const authenticator = createFakeChangePasswordAuthenticator();
  const connectivity = createFakeConnectivity(offline);
  const changePassword = createChangePassword({ authenticator, connectivity });
  return {
    changePassword,
    authenticator,
    connectivity,
    ...screenHarness<
      ReturnType<typeof changePasswordReducer>,
      ChangePasswordEvent
    >(changePasswordReducer),
  };
}

describe("パスワード変更の手続き", () => {
  it("現在のパスワードと新しいパスワードで更新を1回頼み、表示中なら完了にする", async () => {
    // Given
    const { changePassword, authenticator, viewOf } = setup();
    const view = viewOf(initialChangePasswordFlow);

    // When
    await changePassword.submit(input, view);

    // Then
    expect(authenticator.updatePassword).toHaveBeenCalledExactlyOnceWith(input);
    expect(view.observedState).toMatchObject({
      submitting: false,
      completed: true,
      error: null,
    });
  });

  it("チェックのやり直しを頼まない(チェックを使わない)", async () => {
    // Given
    const { changePassword, resetCheck, viewOf } = setup();

    // When
    await changePassword.submit(input, viewOf(initialChangePasswordFlow));

    // Then
    expect(resetCheck).not.toHaveBeenCalled();
  });

  it.each([
    ["現在のパスワードが未入力", { ...input, currentPassword: "" }],
    ["新しいパスワードが未入力", { ...input, newPassword: "" }],
    ["新しいパスワードに全角を含む", { ...input, newPassword: "パスワード1" }],
  ])("%sなら、更新を頼まず、不備を示す", async (_name, invalid) => {
    // Given
    const { changePassword, authenticator, events, viewOf } = setup();
    const view = viewOf(initialChangePasswordFlow);

    // When
    await changePassword.submit(invalid, view);

    // Then
    expect(authenticator.updatePassword).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(Object.keys(view.observedState.fieldErrors)).not.toEqual([]);
  });

  it("オフラインなら、更新を頼まず、offlineを示し、送信中にしない", async () => {
    // Given
    const { changePassword, authenticator, events, viewOf } = setup(true);
    const view = viewOf(initialChangePasswordFlow);

    // When
    await changePassword.submit(input, view);

    // Then
    expect(authenticator.updatePassword).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(view.observedState).toMatchObject({
      error: "offline",
      submitting: false,
    });
  });

  it("オフラインの読み取りは送信ごとに1回で、購読しない", async () => {
    // Given
    const { changePassword, connectivity, viewOf } = setup(true);

    // When
    await changePassword.submit(input, viewOf(initialChangePasswordFlow));

    // Then
    expect(connectivity.subscribers()).toEqual({ online: 0 });
  });

  it("実行中なら、何も送らず、更新を頼まない", async () => {
    // Given
    const { changePassword, authenticator, events, viewOf } = setup();
    const running = { ...initialChangePasswordFlow, submitting: true };

    // When
    await changePassword.submit(input, viewOf(running));

    // Then
    expect(authenticator.updatePassword).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it.each<[string, AuthFailure]>([
    ["現在のパスワードの誤り", { kind: "current_password_invalid" }],
    ["通信の断", UNREACHABLE],
  ])(
    "%sで失敗しても、失敗を示して再試行でき、完了にしない",
    async (_name, failure) => {
      // Given
      const { changePassword, authenticator, events, viewOf } = setup();
      authenticator.updatePassword.mockResolvedValueOnce({
        kind: "failed",
        failure,
      });
      const view = viewOf(initialChangePasswordFlow);
      await changePassword.submit(input, view);
      const afterFailure = view.observedState;

      // When
      await changePassword.submit(input, view);

      // Then
      expect(events).toEqual([
        { type: "failed", failure },
        { type: "changed" },
      ]);
      expect(afterFailure).toMatchObject({
        error: failure.kind,
        submitting: false,
        completed: false,
      });
      expect(authenticator.updatePassword).toHaveBeenCalledTimes(2);
      expect(view.observedState.completed).toBe(true);
    },
  );

  it("応答の前に画面を離れても、更新は頼んだまま進み、応答の後に状態を更新しない", async () => {
    // Given
    const { changePassword, authenticator, events, screen, viewOf } = setup();
    const response = Promise.withResolvers<CallResult>();
    authenticator.updatePassword.mockReturnValue(response.promise);
    const running = changePassword.submit(
      input,
      viewOf(initialChangePasswordFlow),
    );

    // When
    screen.mounted = false;
    response.resolve(accepted);
    await running;

    // Then
    expect(authenticator.updatePassword).toHaveBeenCalledExactlyOnceWith(input);
    expect(events).toEqual([]);
  });

  it("同じタスクで続けて2回呼んでも、2回目は実行中を見て拒否され、更新は1回になる", async () => {
    // Given
    const { changePassword, authenticator, viewOf } = setup();
    const view = viewOf(initialChangePasswordFlow);

    // When
    const first = changePassword.submit(input, view);
    const second = changePassword.submit(input, view);
    await Promise.all([first, second]);

    // Then
    expect(authenticator.updatePassword).toHaveBeenCalledOnce();
  });

  it("オフラインで送信して拒否された後、オンラインで再送信すると、更新は1回だけ呼ばれる", async () => {
    // Given
    const { changePassword, authenticator, connectivity, viewOf } = setup(true);
    const view = viewOf(initialChangePasswordFlow);
    await changePassword.submit(input, view);

    // When
    connectivity.goOnline();
    await changePassword.submit(input, view);

    // Then
    expect(authenticator.updatePassword).toHaveBeenCalledExactlyOnceWith(input);
    expect(view.observedState).toMatchObject({
      error: null,
      completed: true,
    });
  });
});

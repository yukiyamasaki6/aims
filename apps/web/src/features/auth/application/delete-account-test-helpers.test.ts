import { describe, expect, it, vi } from "vitest";
import { createDeleteAccountHarness } from "./delete-account-test-helpers";

describe("createDeleteAccountHarness", () => {
  it("既定では、再認証と削除と消去が成功し、サインインの状態は認証済み(user-1)である", async () => {
    // Given
    const { authenticator, account, eraser } = createDeleteAccountHarness();

    // When
    const reauthentication = await authenticator.reauthenticate({
      password: "p",
      captchaToken: "t",
    });
    const deletion = await account.delete();
    const erasing = eraser.erase("user-1");
    const reading = await authenticator.readSession();

    // Then
    expect(reauthentication).toEqual({ kind: "verified", userId: "user-1" });
    expect(deletion).toEqual({ kind: "deleted" });
    await expect(erasing).resolves.toBeUndefined();
    expect(reading).toEqual({ status: "authenticated", userId: "user-1" });
  });

  it("この端末のサインインを終えると、サインインの状態が未認証になる", async () => {
    // Given
    const { authenticator, state } = createDeleteAccountHarness();

    // When
    const result = await authenticator.signOutHere();
    const reading = await authenticator.readSession();

    // Then
    expect(result).toEqual({ kind: "accepted" });
    expect(state.status).toBe("unauthenticated");
    expect(reading).toEqual({ status: "unauthenticated" });
  });

  it("購読した人へ出来事を届け、解除した人へは届けない", () => {
    // Given
    const { authenticator, emit } = createDeleteAccountHarness();
    const listener = vi.fn();
    const stop = authenticator.subscribe(listener);

    // When
    emit({ kind: "signed-out" });
    stop();
    emit({ kind: "signed-out" });

    // Then
    expect(listener).toHaveBeenCalledOnce();
  });

  it("通信の可否と今の場所を、引数で決める", () => {
    // Given
    const { connectivity, page } = createDeleteAccountHarness({
      offline: true,
      here: "/settings",
    });

    // When
    const here = page.here();

    // Then
    expect(connectivity.isOffline()).toBe(true);
    expect(here).toBe("/settings");
  });

  it("実物のセッションは、記録の利用者がuser-1で、別の利用者のサインインだけを、今の場所の読み込み直しにする", () => {
    // Given
    const { session, page, emit } = createDeleteAccountHarness({
      here: "/settings",
    });
    const unwatch = session.watch();

    // When
    emit({ kind: "signed-in", userId: "user-1" });
    const sameUser = page.replace.mock.calls.length;
    emit({ kind: "signed-in", userId: "user-2" });
    unwatch();

    // Then
    expect(sameUser).toBe(0);
    expect(page.replace).toHaveBeenCalledExactlyOnceWith("/settings");
  });
});

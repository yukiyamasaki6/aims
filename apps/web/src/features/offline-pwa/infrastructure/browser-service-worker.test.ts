import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserServiceWorker } from "./browser-service-worker";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeContainer(registration: unknown) {
  const listeners: Array<() => void> = [];
  return {
    listeners,
    container: {
      getRegistration: () => Promise.resolve(registration),
      addEventListener: (_: string, listener: () => void) =>
        listeners.push(listener),
      removeEventListener: (_: string, listener: () => void) => {
        listeners.splice(listeners.indexOf(listener), 1);
      },
    },
  };
}

describe("createBrowserServiceWorker", () => {
  it("Service Workerに未対応の環境では、登録が無い(undefined)", async () => {
    // Given
    vi.stubGlobal("navigator", {});

    // When
    const registration = await createBrowserServiceWorker().getRegistration();

    // Then
    expect(registration).toBeUndefined();
  });

  it("未対応の環境でも、controllerchangeの購読と解除はエラーにならない", () => {
    // Given
    vi.stubGlobal("navigator", {});

    // When
    const stop = createBrowserServiceWorker().onControllerChange(() => {});

    // Then
    expect(stop).not.toThrow();
  });

  it("登録が無ければundefinedを返す", async () => {
    // Given
    vi.stubGlobal("navigator", {
      serviceWorker: fakeContainer(undefined).container,
    });

    // When
    const registration = await createBrowserServiceWorker().getRegistration();

    // Then
    expect(registration).toBeUndefined();
  });

  it("登録のwaitingを同期で読み、待機中の版へSKIP_WAITINGを送り、更新を確認する", async () => {
    // Given
    const postMessage = vi.fn();
    const raw = {
      waiting: null as { postMessage: typeof postMessage } | null,
      update: vi.fn(() => Promise.resolve()),
    };
    vi.stubGlobal("navigator", { serviceWorker: fakeContainer(raw).container });
    const registration = await createBrowserServiceWorker().getRegistration();

    // When
    const withoutWaiting = registration?.waiting;
    registration?.skipWaiting();
    raw.waiting = { postMessage };
    const withWaiting = registration?.waiting;
    registration?.skipWaiting();
    await registration?.update();

    // Then
    expect(withoutWaiting).toBe(false);
    expect(withWaiting).toBe(true);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "SKIP_WAITING",
    });
    expect(raw.update).toHaveBeenCalledTimes(1);
  });

  it("controllerchangeを購読し、返した関数で解除する", () => {
    // Given
    const fake = fakeContainer(undefined);
    vi.stubGlobal("navigator", { serviceWorker: fake.container });
    const listener = vi.fn();

    // When
    const stop = createBrowserServiceWorker().onControllerChange(listener);
    const subscribed = fake.listeners.length;
    for (const registered of fake.listeners) registered();
    stop();

    // Then
    expect(subscribed).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fake.listeners).toHaveLength(0);
  });
});

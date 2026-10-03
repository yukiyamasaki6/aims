import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwUpdateActivator } from "./sw-update-activator";

// ブラウザのService Worker APIは境界のため、登録とwaiting/installingのワーカーを任意に操作できるスタブで模す。
type Listener = () => void;

function fakeWorker(state = "installing") {
  const listeners: Listener[] = [];
  return {
    state,
    postMessage: vi.fn(),
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    emitStateChange(next: string) {
      this.state = next;
      for (const l of listeners) l();
    },
  };
}

function fakeRegistration() {
  const listeners: Listener[] = [];
  return {
    waiting: null as ReturnType<typeof fakeWorker> | null,
    installing: null as ReturnType<typeof fakeWorker> | null,
    addEventListener: vi.fn((_: string, l: Listener) => listeners.push(l)),
    removeEventListener: vi.fn(),
    emitUpdateFound() {
      for (const l of listeners) l();
    },
  };
}

let registration = fakeRegistration();

beforeEach(() => {
  vi.useFakeTimers();
  registration = fakeRegistration();
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration: () => Promise.resolve(registration) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount() {
  const view = render(<SwUpdateActivator />);
  await vi.advanceTimersByTimeAsync(0);
  return view;
}

describe("SwUpdateActivator", () => {
  it("読み込み時にwaitingの新SWがあればSKIP_WAITINGを送る", async () => {
    // Given
    const waiting = fakeWorker("installed");
    registration.waiting = waiting;

    // When
    await mount();

    // Then
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("更新で新SWがinstalledになり、waitingに残っていればSKIP_WAITINGを送る", async () => {
    // Given
    await mount();
    const installing = fakeWorker();
    registration.installing = installing;
    registration.emitUpdateFound();

    // When
    registration.waiting = installing;
    installing.emitStateChange("installed");

    // Then
    expect(installing.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });
  });

  it("installedの時点でwaitingでなければ（有効化が進んでいれば）何も送らない", async () => {
    // Given
    await mount();
    const installing = fakeWorker();
    registration.installing = installing;
    registration.emitUpdateFound();

    // When
    installing.emitStateChange("installed");

    // Then
    expect(installing.postMessage).not.toHaveBeenCalled();
  });

  it("waitingのままなら間隔を空けて最大3回まで再要求し、有効化されたら止める", async () => {
    // Given
    const waiting = fakeWorker("installed");
    registration.waiting = waiting;
    await mount();

    // When
    await vi.advanceTimersByTimeAsync(1_000);
    registration.waiting = null;
    await vi.advanceTimersByTimeAsync(10_000);

    // Then
    expect(waiting.postMessage).toHaveBeenCalledTimes(2);
  });

  it("有効化されなくても3回で打ち切る", async () => {
    // Given
    const waiting = fakeWorker("installed");
    registration.waiting = waiting;
    await mount();

    // When
    await vi.advanceTimersByTimeAsync(10_000);

    // Then
    expect(waiting.postMessage).toHaveBeenCalledTimes(3);
  });

  it("アンマウントで再要求とupdatefoundの購読を止める", async () => {
    // Given
    const waiting = fakeWorker("installed");
    registration.waiting = waiting;
    const view = await mount();

    // When
    view.unmount();
    await vi.advanceTimersByTimeAsync(10_000);

    // Then
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
    expect(registration.removeEventListener).toHaveBeenCalledWith(
      "updatefound",
      expect.any(Function),
    );
  });

  it("Service Workerに未対応でもエラーにならない", () => {
    // Given
    vi.stubGlobal("navigator", {});

    // When
    // Then
    expect(() => render(<SwUpdateActivator />)).not.toThrow();
  });

  it("登録が無ければ何もしない", async () => {
    // Given
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: () => Promise.resolve(undefined) },
    });

    // When
    const view = render(<SwUpdateActivator />);
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(() => view.unmount()).not.toThrow();
  });

  it("登録の取得前にアンマウントされたら購読しない", async () => {
    // Given
    const view = render(<SwUpdateActivator />);

    // When
    view.unmount();
    await vi.advanceTimersByTimeAsync(0);

    // Then
    expect(registration.addEventListener).not.toHaveBeenCalled();
  });

  it("updatefoundの時点でinstallingが無ければ何もしない", async () => {
    // Given
    await mount();

    // When
    registration.installing = null;
    // Then
    expect(() => registration.emitUpdateFound()).not.toThrow();
  });
});

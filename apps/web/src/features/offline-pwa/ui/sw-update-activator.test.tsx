import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import {
  createUpdateActivation,
  type UpdateActivation,
} from "../application/update-activation";
import { createBrowserLinkClicks } from "../infrastructure/browser-link-clicks";
import { createBrowserServiceWorker } from "../infrastructure/browser-service-worker";
import { SwUpdateActivator } from "./sw-update-activator";

const nav = vi.hoisted(() => ({ pathname: "/rounds" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

function fakeActivation() {
  const pathChanged = vi.fn();
  const start = vi.fn(() => () => {});
  return {
    activation: { start, pathChanged } satisfies UpdateActivation,
    pathChanged,
  };
}

describe("SwUpdateActivator", () => {
  it("何も表示しない", () => {
    // Given
    const { activation } = fakeActivation();

    // When
    const { container } = render(<SwUpdateActivator activation={activation} />);

    // Then
    expect(container).toBeEmptyDOMElement();
  });

  it("表示したときに、経路の通知を1回送る", () => {
    // Given
    nav.pathname = "/rounds";
    const { activation, pathChanged } = fakeActivation();

    // When
    render(<SwUpdateActivator activation={activation} />);

    // Then
    expect(pathChanged).toHaveBeenCalledTimes(1);
  });

  it("経路が変わるたびに通知を送り、変わらない再描画では送らない", () => {
    // Given
    nav.pathname = "/rounds";
    const { activation, pathChanged } = fakeActivation();
    const view = render(<SwUpdateActivator activation={activation} />);

    // When
    view.rerender(<SwUpdateActivator activation={activation} />);
    nav.pathname = "/rounds/new";
    view.rerender(<SwUpdateActivator activation={activation} />);

    // Then
    expect(pathChanged).toHaveBeenCalledTimes(2);
  });

  it("アンマウントの後は、通知を送らない", () => {
    // Given
    nav.pathname = "/rounds";
    const { activation, pathChanged } = fakeActivation();
    const view = render(<SwUpdateActivator activation={activation} />);
    view.unmount();

    // When
    nav.pathname = "/rounds/new";

    // Then
    expect(pathChanged).toHaveBeenCalledTimes(1);
  });
});

// 手続きの単体が通っても壊れる配線(実物のインフラの差し込み、経路の通知、期限の共有)を、旧来の入力と期待値のまま、実物のインフラと偽のブラウザ境界で確かめる。
describe("SwUpdateActivator と実物のインフラの合成", () => {
  const persistence = { whenPersisted: vi.fn<() => Promise<void>>() };
  const assign = vi.fn();
  let registration = fakeRegistration();
  let controllerListeners: Array<() => void> = [];
  let stops: Array<() => void> = [];

  function fakeWorker() {
    return { postMessage: vi.fn() };
  }

  function fakeRegistration() {
    return {
      waiting: null as ReturnType<typeof fakeWorker> | null,
      update: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };
  }

  function emitControllerChange() {
    for (const listener of [...controllerListeners]) listener();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    nav.pathname = "/rounds";
    persistence.whenPersisted.mockReset();
    persistence.whenPersisted.mockResolvedValue(undefined);
    assign.mockReset();
    registration = fakeRegistration();
    controllerListeners = [];
    stops = [];
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: () => Promise.resolve(registration),
        addEventListener: (_: string, listener: () => void) =>
          controllerListeners.push(listener),
        removeEventListener: (_: string, listener: () => void) => {
          controllerListeners = controllerListeners.filter(
            (x) => x !== listener,
          );
        },
      },
    });
    vi.stubGlobal("location", {
      href: "http://localhost/rounds",
      origin: "http://localhost",
      pathname: "/rounds",
      search: "",
      assign,
    });
  });

  afterEach(() => {
    for (const stop of stops) stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function settle() {
    await vi.advanceTimersByTimeAsync(0);
  }

  // ルートの入口と同じ形で、手続きを始め、画面の部品へ渡す。
  async function mount() {
    const activation = createUpdateActivation({
      host: createBrowserServiceWorker(),
      links: createBrowserLinkClicks(),
      persistence,
      clock: createBrowserClock(),
      deadlineMs: 1_000,
    });
    stops.push(activation.start());
    const view = render(<SwUpdateActivator activation={activation} />);
    await settle();
    return {
      navigate: async (to: string) => {
        nav.pathname = to;
        view.rerender(<SwUpdateActivator activation={activation} />);
        await settle();
      },
    };
  }

  function addLink(href: string) {
    const a = document.createElement("a");
    a.href = href;
    a.addEventListener("click", (e) => e.preventDefault());
    document.body.append(a);
    return a;
  }

  it("waitingがあれば遷移を止め、保存の完了後にSKIP_WAITINGを1回送り、controllerchangeの後にlocation.assignする", async () => {
    // Given
    let finish: () => void = () => {};
    persistence.whenPersisted.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const waiting = fakeWorker();
    registration.waiting = waiting;
    await mount();
    const link = addLink("http://localhost/rounds/new");
    const passed = vi.fn();
    document.addEventListener("click", passed);

    // When
    fireEvent.click(link);
    await vi.advanceTimersByTimeAsync(100);
    const sentBeforePersisted = waiting.postMessage.mock.calls.length;
    finish();
    await settle();
    const sentAfterPersisted = waiting.postMessage.mock.calls.length;
    const assignedBeforeChange = assign.mock.calls.length;
    emitControllerChange();
    await settle();

    // Then
    expect(sentBeforePersisted).toBe(0);
    expect(sentAfterPersisted).toBe(1);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(assignedBeforeChange).toBe(0);
    expect(passed).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("http://localhost/rounds/new");
  });

  it("waitingが無ければ止めず、保存の完了も待たない", async () => {
    // Given
    await mount();
    const link = addLink("http://localhost/rounds/new");
    const passed = vi.fn();
    document.addEventListener("click", passed);

    // When
    fireEvent.click(link);
    await settle();

    // Then
    expect(passed).toHaveBeenCalledTimes(1);
    expect(persistence.whenPersisted).not.toHaveBeenCalled();
  });

  it("登録の保持の前のclickは止めず、遅れて登録が返っても、合図を送らず保存の完了も待たない", async () => {
    // Given
    let resolveRegistration: (r: unknown) => void = () => {};
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: () =>
          new Promise((resolve) => {
            resolveRegistration = resolve;
          }),
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
    const waiting = fakeWorker();
    registration.waiting = waiting;
    await mount();
    const link = addLink("http://localhost/rounds/new");
    const passed = vi.fn();
    document.addEventListener("click", passed);

    // When
    fireEvent.click(link);
    resolveRegistration(registration);
    await settle();

    // Then
    expect(passed).toHaveBeenCalledTimes(1);
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(persistence.whenPersisted).not.toHaveBeenCalled();
  });

  it("controllerchangeが1秒来なければ、合図を1回だけ送り、押し直して通常の遷移を進める", async () => {
    // Given
    const waiting = fakeWorker();
    registration.waiting = waiting;
    await mount();
    const link = addLink("http://localhost/rounds/new");
    const passed = vi.fn();
    document.addEventListener("click", passed);

    // When
    fireEvent.click(link);
    await vi.advanceTimersByTimeAsync(1_000);

    // Then
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
    expect(passed).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    expect(persistence.whenPersisted).toHaveBeenCalledTimes(1);
  });

  it("保存が1秒で終わらなければ、合図を送らずに押し直す", async () => {
    // Given
    persistence.whenPersisted.mockReturnValueOnce(new Promise<void>(() => {}));
    const waiting = fakeWorker();
    registration.waiting = waiting;
    await mount();
    const link = addLink("http://localhost/rounds/new");
    const passed = vi.fn();
    document.addEventListener("click", passed);

    // When
    fireEvent.click(link);
    await vi.advanceTimersByTimeAsync(1_000);

    // Then
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(passed).toHaveBeenCalledTimes(1);
  });

  it("保存待ちと有効化待ちは、クリックから1つの1秒を共有する", async () => {
    // Given
    registration.waiting = fakeWorker();
    await mount();
    let finish: () => void = () => {};
    persistence.whenPersisted.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(addLink("http://localhost/rounds/new"));
    await vi.advanceTimersByTimeAsync(900);
    finish();
    await settle();

    // When
    await vi.advanceTimersByTimeAsync(99);
    const beforeDeadline = assign.mock.calls.length;
    emitControllerChange();
    await settle();
    const afterChange = assign.mock.calls.length;

    // Then
    expect(beforeDeadline).toBe(0);
    expect(afterChange).toBe(1);
  });

  it("切り替え中の追加のclickは止めたまま、二重に始めない", async () => {
    // Given
    const waiting = fakeWorker();
    registration.waiting = waiting;
    await mount();
    const link = addLink("http://localhost/rounds/new");
    const passed = vi.fn();
    document.addEventListener("click", passed);
    fireEvent.click(link);
    await settle();

    // When
    fireEvent.click(link);
    await settle();

    // Then
    expect(passed).not.toHaveBeenCalled();
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });

  it("画面の経路が変わると、waitingが無ければ更新を確認し、読み込み時は確認しない", async () => {
    // Given
    const { navigate } = await mount();
    const updatesAtLoad = registration.update.mock.calls.length;

    // When
    await navigate("/rounds/new");

    // Then
    expect(updatesAtLoad).toBe(0);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it("Service Workerに未対応の環境でも、手続きを始めて描画してもエラーにならない", async () => {
    // Given
    vi.stubGlobal("navigator", {});

    // When
    const result = mount();

    // Then
    await expect(result).resolves.toBeDefined();
  });
});

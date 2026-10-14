import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwUpdateActivator } from "./sw-update-activator";

const mocks = vi.hoisted(() => ({
  pathname: "/rounds",
  whenPersisted: vi.fn<() => Promise<void>>(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/app/(main)/rounds/_shared/round-op-hub", () => ({
  roundOpHub: { whenPersisted: mocks.whenPersisted },
}));

// ブラウザのService Worker APIは境界のため、登録とwaitingのワーカー、controllerchangeを任意に操作できるスタブで模す。
function fakeWorker() {
  return { postMessage: vi.fn() };
}

function fakeRegistration() {
  return {
    waiting: null as ReturnType<typeof fakeWorker> | null,
    update: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  };
}

let registration = fakeRegistration();
let controllerListeners: Array<() => void> = [];
const reload = vi.fn();

function emitControllerChange() {
  for (const listener of [...controllerListeners]) listener();
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.pathname = "/rounds";
  mocks.whenPersisted.mockReset();
  mocks.whenPersisted.mockResolvedValue(undefined);
  reload.mockReset();
  registration = fakeRegistration();
  controllerListeners = [];
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: () => Promise.resolve(registration),
      addEventListener: (_: string, l: () => void) =>
        controllerListeners.push(l),
      removeEventListener: (_: string, l: () => void) => {
        controllerListeners = controllerListeners.filter((x) => x !== l);
      },
    },
  });
  vi.stubGlobal("location", { reload });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

async function mount() {
  const view = render(<SwUpdateActivator />);
  await settle();
  return view;
}

async function navigate(view: Awaited<ReturnType<typeof mount>>, to: string) {
  mocks.pathname = to;
  view.rerender(<SwUpdateActivator />);
  await settle();
}

describe("SwUpdateActivator", () => {
  describe("読み込み時", () => {
    it("waitingの新SWがあればSKIP_WAITINGを送り、controllerchangeの後に再読み込みする", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      await mount();
      expect(waiting.postMessage).toHaveBeenCalledWith({
        type: "SKIP_WAITING",
      });
      expect(reload).not.toHaveBeenCalled();

      // When
      emitControllerChange();
      await settle();

      // Then
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("waitingが無ければ何も送らず、更新も確認しない", async () => {
      // Given
      // When
      await mount();
      await vi.advanceTimersByTimeAsync(10_000);

      // Then
      expect(registration.update).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe("クライアント側の遷移", () => {
    it("waitingがあれば切り替えて再読み込みする", async () => {
      // Given
      const view = await mount();
      const waiting = fakeWorker();
      registration.waiting = waiting;

      // When
      await navigate(view, "/rounds/new");
      emitControllerChange();
      await settle();

      // Then
      expect(waiting.postMessage).toHaveBeenCalledWith({
        type: "SKIP_WAITING",
      });
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("waitingが無ければ更新を確認し、再読み込みしない", async () => {
      // Given
      const view = await mount();

      // When
      await navigate(view, "/rounds/new");
      await vi.advanceTimersByTimeAsync(10_000);

      // Then
      expect(registration.update).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
    });

    it("更新の確認が拒否されてもエラーにならない", async () => {
      // Given
      const view = await mount();
      registration.update.mockRejectedValue(new Error("offline"));

      // When
      // Then
      await expect(navigate(view, "/rounds/new")).resolves.toBeUndefined();
    });

    it("切り替え中の次の遷移で二重に始めない", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      const view = await mount();

      // When
      await navigate(view, "/rounds/new");
      await navigate(view, "/rounds");

      // Then
      expect(waiting.postMessage).toHaveBeenCalledTimes(1);
      expect(registration.update).not.toHaveBeenCalled();
    });
  });

  describe("切り替え", () => {
    it("updatefoundやinstalledでは送らない(待機させる)", async () => {
      // Given
      // When
      await mount();

      // Then
      expect(registration.waiting).toBeNull();
    });

    it("controllerchangeが来なければ1秒間隔で最大3回送り、打ち切って再読み込みしない", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      await mount();

      // When
      await vi.advanceTimersByTimeAsync(10_000);
      emitControllerChange();
      await settle();

      // Then
      expect(waiting.postMessage).toHaveBeenCalledTimes(3);
      expect(reload).not.toHaveBeenCalled();
    });

    it("打ち切った後の次の遷移で再び試みる", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      const view = await mount();
      await vi.advanceTimersByTimeAsync(10_000);

      // When
      await navigate(view, "/rounds/new");

      // Then
      expect(waiting.postMessage).toHaveBeenCalledTimes(4);
    });

    it("保存の完了まで再読み込みしない", async () => {
      // Given
      let finish: () => void = () => {};
      mocks.whenPersisted.mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      registration.waiting = fakeWorker();
      await mount();

      // When
      emitControllerChange();
      await vi.advanceTimersByTimeAsync(500);
      expect(reload).not.toHaveBeenCalled();
      finish();
      await settle();

      // Then
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("保存が上限の1秒で終わらなければ再読み込みしない", async () => {
      // Given
      let finish: () => void = () => {};
      mocks.whenPersisted.mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      registration.waiting = fakeWorker();
      await mount();

      // When
      emitControllerChange();
      await vi.advanceTimersByTimeAsync(1_000);
      finish();
      await settle();

      // Then
      expect(reload).not.toHaveBeenCalled();
    });

    it("保存が間に合わず再読み込みしなかったときは、次の遷移で再読み込みする", async () => {
      // Given
      mocks.whenPersisted.mockReturnValueOnce(new Promise<void>(() => {}));
      registration.waiting = fakeWorker();
      const view = await mount();
      emitControllerChange();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(reload).not.toHaveBeenCalled();
      registration.waiting = null;

      // When
      await navigate(view, "/rounds/new");

      // Then
      expect(reload).toHaveBeenCalledTimes(1);
      expect(registration.update).not.toHaveBeenCalled();
    });

    it("次の遷移でも保存が間に合わなければ再読み込みせず、その次の遷移で再び試みる", async () => {
      // Given
      mocks.whenPersisted.mockReturnValueOnce(new Promise<void>(() => {}));
      mocks.whenPersisted.mockReturnValueOnce(new Promise<void>(() => {}));
      registration.waiting = fakeWorker();
      const view = await mount();
      emitControllerChange();
      await vi.advanceTimersByTimeAsync(1_000);
      registration.waiting = null;
      await navigate(view, "/rounds/new");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(reload).not.toHaveBeenCalled();

      // When
      await navigate(view, "/rounds");

      // Then
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it("アンマウントで送り直しと購読を止める", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      const view = await mount();

      // When
      view.unmount();
      await vi.advanceTimersByTimeAsync(10_000);
      emitControllerChange();
      await settle();

      // Then
      expect(waiting.postMessage).toHaveBeenCalledTimes(1);
      expect(controllerListeners).toHaveLength(0);
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe("環境", () => {
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
      await settle();

      // Then
      expect(() => view.unmount()).not.toThrow();
    });

    it("登録の取得前にアンマウントされたら切り替えない", async () => {
      // Given
      const waiting = fakeWorker();
      registration.waiting = waiting;
      const view = render(<SwUpdateActivator />);

      // When
      view.unmount();
      await settle();

      // Then
      expect(waiting.postMessage).not.toHaveBeenCalled();
    });
  });
});

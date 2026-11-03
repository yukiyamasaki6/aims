import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import {
  createUpdateActivation,
  type LinkClick,
  type SwHost,
  type SwRegistration,
} from "./update-activation";

const DEADLINE_MS = 1000;

type FakeRegistration = SwRegistration & {
  waiting: boolean;
  skipWaiting: ReturnType<typeof vi.fn<() => void>>;
  update: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

// 境界(Service Workerの提供元、リンク操作の購読、保存の待ち、時計)を、テストが動かせる偽に替える。
function setup(options: { registered?: boolean } = {}) {
  const clock = createManualClock();
  const registration: FakeRegistration = {
    waiting: false,
    skipWaiting: vi.fn<() => void>(),
    update: vi.fn<() => Promise<void>>(async () => {}),
  };
  let registrationReady: (value: SwRegistration | undefined) => void = () => {};
  const controllerListeners = new Set<() => void>();
  const host: SwHost = {
    getRegistration: vi.fn(async () =>
      options.registered === false ? undefined : registration,
    ),
    onControllerChange: (listener) => {
      controllerListeners.add(listener);
      return () => controllerListeners.delete(listener);
    },
  };
  let clickListener: ((link: LinkClick | null) => void) | undefined;
  const links = {
    onClick: vi.fn((listener: (link: LinkClick | null) => void) => {
      clickListener = listener;
      return () => {
        clickListener = undefined;
      };
    }),
  };
  const persistence = {
    whenPersisted: vi.fn<() => Promise<void>>(async () => {}),
  };
  const activation = createUpdateActivation({
    host,
    links,
    persistence,
    clock,
    deadlineMs: DEADLINE_MS,
  });
  return {
    activation,
    clock,
    registration,
    host,
    persistence,
    links,
    controllerListeners,
    emitControllerChange: () => {
      for (const listener of [...controllerListeners]) listener();
    },
    click: (link: LinkClick | null) => clickListener?.(link),
    hasListener: () => clickListener !== undefined,
    withheldRegistration() {
      host.getRegistration = vi.fn(
        () =>
          new Promise<SwRegistration | undefined>((resolve) => {
            registrationReady = resolve;
          }),
      );
      return () => registrationReady(registration);
    },
  };
}

function fakeLink() {
  return { block: vi.fn(), follow: vi.fn(), repeat: vi.fn() };
}

// 読み込み(最初の経路の通知)を済ませ、登録を保持した状態で始める。
async function started(options: { registered?: boolean } = {}) {
  const env = setup(options);
  const stop = env.activation.start();
  await env.clock.advanceAsync(0);
  return { ...env, stop };
}

// 未処理の拒否は実イベントループの次のターンで通知されるため、manual clockとは別に実タイマーで1ターン待ってから数える。
function watchUnhandledRejections() {
  const reasons: unknown[] = [];
  const listener = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", listener);
  return {
    reasons,
    async settle() {
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    stop: () => process.off("unhandledRejection", listener),
  };
}

describe("createUpdateActivation", () => {
  describe("リンク操作の前の切り替え", () => {
    it("waitingがあれば遷移を止め、保存の完了後にSKIP_WAITINGを1回送り、controllerchangeの後に遷移する", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      let finish: () => void = () => {};
      env.persistence.whenPersisted.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const link = fakeLink();

      // When
      env.click(link);
      await env.clock.advanceAsync(100);
      const sentBeforePersisted =
        env.registration.skipWaiting.mock.calls.length;
      finish();
      await env.clock.advanceAsync(0);
      const sentAfterPersisted = env.registration.skipWaiting.mock.calls.length;
      const followedBeforeChange = link.follow.mock.calls.length;
      env.emitControllerChange();
      await env.clock.advanceAsync(0);

      // Then
      expect(link.block).toHaveBeenCalledTimes(1);
      expect(sentBeforePersisted).toBe(0);
      expect(sentAfterPersisted).toBe(1);
      expect(followedBeforeChange).toBe(0);
      expect(link.follow).toHaveBeenCalledTimes(1);
      expect(link.repeat).not.toHaveBeenCalled();
    });

    it("waitingが無ければ止めず、保存の完了も待たない", async () => {
      // Given
      const env = await started();
      const link = fakeLink();

      // When
      env.click(link);
      await env.clock.advanceAsync(0);

      // Then
      expect(link.block).not.toHaveBeenCalled();
      expect(env.persistence.whenPersisted).not.toHaveBeenCalled();
    });

    it("内部の通常のリンク操作でない操作(null)は、何もしない", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;

      // When
      env.click(null);
      await env.clock.advanceAsync(0);

      // Then
      expect(env.persistence.whenPersisted).not.toHaveBeenCalled();
      expect(env.registration.skipWaiting).not.toHaveBeenCalled();
    });

    it("登録の保持の前のclickは止めず、遅れて登録が返っても、合図を送らず保存の完了も待たない", async () => {
      // Given
      const env = setup();
      env.registration.waiting = true;
      const release = env.withheldRegistration();
      env.activation.start();
      const link = fakeLink();

      // When
      env.click(link);
      release();
      await env.clock.advanceAsync(0);

      // Then
      expect(link.block).not.toHaveBeenCalled();
      expect(env.registration.skipWaiting).not.toHaveBeenCalled();
      expect(env.persistence.whenPersisted).not.toHaveBeenCalled();
    });

    it("登録の保持の前のclickで通した遷移では、更新を確認しない", async () => {
      // Given
      const env = setup();
      const release = env.withheldRegistration();
      env.activation.pathChanged();
      env.activation.start();
      env.click(fakeLink());
      release();
      await env.clock.advanceAsync(0);

      // When
      env.activation.pathChanged();

      // Then
      expect(env.registration.update).not.toHaveBeenCalled();
    });

    it("登録が無ければ、リンクの遷移を止めない", async () => {
      // Given
      const env = await started({ registered: false });
      const link = fakeLink();

      // When
      env.click(link);
      await env.clock.advanceAsync(0);

      // Then
      expect(link.block).not.toHaveBeenCalled();
    });

    it("controllerchangeが1秒来なければ、合図を1回だけ送り、押し直して通常の遷移を進める", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      const link = fakeLink();

      // When
      env.click(link);
      await env.clock.advanceAsync(DEADLINE_MS);

      // Then
      expect(env.registration.skipWaiting).toHaveBeenCalledTimes(1);
      expect(link.repeat).toHaveBeenCalledTimes(1);
      expect(link.follow).not.toHaveBeenCalled();
      expect(env.persistence.whenPersisted).toHaveBeenCalledTimes(1);
      expect(env.controllerListeners.size).toBe(0);
    });

    it("切り替えを諦めて通した遷移では、更新を確認しない", async () => {
      // Given
      const env = await started();
      env.activation.pathChanged();
      env.registration.waiting = true;
      env.click(fakeLink());
      await env.clock.advanceAsync(DEADLINE_MS);
      // 待機が無い遷移なら更新を確認する状態にし、諦めて通したことだけが更新を抑えることを確かめる。
      env.registration.waiting = false;

      // When
      env.activation.pathChanged();

      // Then
      expect(env.registration.update).not.toHaveBeenCalled();
    });

    it("保存が1秒で終わらなければ、合図を送らずに押し直す", async () => {
      // Given
      const env = await started();
      env.persistence.whenPersisted.mockReturnValueOnce(
        new Promise<void>(() => {}),
      );
      env.registration.waiting = true;
      const link = fakeLink();

      // When
      env.click(link);
      await env.clock.advanceAsync(DEADLINE_MS);

      // Then
      expect(env.registration.skipWaiting).not.toHaveBeenCalled();
      expect(link.repeat).toHaveBeenCalledTimes(1);
    });

    it("controllerchangeの後、遷移の直前に保存を再確認し、追記された保存の完了を待つ", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      let finish: () => void = () => {};
      env.persistence.whenPersisted
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        );
      const link = fakeLink();
      env.click(link);
      await env.clock.advanceAsync(0);

      // When
      env.emitControllerChange();
      await env.clock.advanceAsync(100);
      const beforeFinish = link.follow.mock.calls.length;
      finish();
      await env.clock.advanceAsync(0);

      // Then
      expect(beforeFinish).toBe(0);
      expect(link.follow).toHaveBeenCalledTimes(1);
    });

    it("再確認が期限を超えたときは遷移せず、押し直して通常の遷移を進める", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      env.persistence.whenPersisted
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(new Promise<void>(() => {}));
      const link = fakeLink();
      env.click(link);
      await env.clock.advanceAsync(0);
      env.emitControllerChange();

      // When
      await env.clock.advanceAsync(DEADLINE_MS);

      // Then
      expect(link.follow).not.toHaveBeenCalled();
      expect(link.repeat).toHaveBeenCalledTimes(1);
    });

    it("保存待ちと有効化待ちは、クリックから1つの1秒を共有する", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      let finish: () => void = () => {};
      env.persistence.whenPersisted.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const link = fakeLink();
      env.click(link);
      await env.clock.advanceAsync(900);
      finish();
      await env.clock.advanceAsync(0);

      // When
      await env.clock.advanceAsync(99);
      const beforeDeadline = link.follow.mock.calls.length;
      env.emitControllerChange();
      await env.clock.advanceAsync(0);

      // Then
      expect(beforeDeadline).toBe(0);
      expect(link.follow).toHaveBeenCalledTimes(1);
    });

    it("保存待ちを900msで済ませても、1秒を過ぎたcontrollerchangeでは切り替えない", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      let finish: () => void = () => {};
      env.persistence.whenPersisted.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const link = fakeLink();
      env.click(link);
      await env.clock.advanceAsync(900);
      finish();
      await env.clock.advanceAsync(0);

      // When
      await env.clock.advanceAsync(100);
      env.emitControllerChange();
      await env.clock.advanceAsync(0);

      // Then
      expect(env.registration.skipWaiting).toHaveBeenCalledTimes(1);
      expect(link.follow).not.toHaveBeenCalled();
    });

    it("切り替え中の追加のclickは止めたまま、二重に始めない", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      const first = fakeLink();
      const second = fakeLink();
      env.click(first);
      await env.clock.advanceAsync(0);

      // When
      env.click(second);
      await env.clock.advanceAsync(0);

      // Then
      expect(second.block).toHaveBeenCalledTimes(1);
      expect(env.registration.skipWaiting).toHaveBeenCalledTimes(1);
      expect(env.persistence.whenPersisted).toHaveBeenCalledTimes(1);
    });

    it("保存の完了待ちの途中で停止すると、保存が完了しても購読もSKIP_WAITINGも起きない", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      let finish: () => void = () => {};
      env.persistence.whenPersisted.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const subscribe = vi.spyOn(env.host, "onControllerChange");
      const link = fakeLink();
      env.click(link);
      await env.clock.advanceAsync(0);

      // When
      env.stop();
      finish();
      await env.clock.advanceAsync(DEADLINE_MS * 2);

      // Then
      expect(subscribe).not.toHaveBeenCalled();
      expect(env.controllerListeners.size).toBe(0);
      expect(env.registration.skipWaiting).not.toHaveBeenCalled();
      expect(link.follow).not.toHaveBeenCalled();
      expect(link.repeat).not.toHaveBeenCalled();
      expect(env.clock.pendingCount()).toBe(0);
    });

    it("controllerchangeの直後、継続が進む前に停止しても、新しい保存待ちを始めない", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      const link = fakeLink();
      env.click(link);
      await env.clock.advanceAsync(0);

      // When
      env.emitControllerChange();
      env.stop();
      await env.clock.advanceAsync(DEADLINE_MS * 2);

      // Then
      expect(env.persistence.whenPersisted).toHaveBeenCalledTimes(1);
      expect(link.follow).not.toHaveBeenCalled();
      expect(link.repeat).not.toHaveBeenCalled();
      expect(env.controllerListeners.size).toBe(0);
      expect(env.clock.pendingCount()).toBe(0);
    });

    it("諦めた遷移の次の遷移では、再び判定して切り替える", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      env.click(fakeLink());
      await env.clock.advanceAsync(DEADLINE_MS);
      env.activation.pathChanged();
      const next = fakeLink();

      // When
      env.click(next);
      await env.clock.advanceAsync(0);
      env.emitControllerChange();
      await env.clock.advanceAsync(0);

      // Then
      expect(env.registration.skipWaiting).toHaveBeenCalledTimes(2);
      expect(next.block).toHaveBeenCalledTimes(1);
      expect(next.follow).toHaveBeenCalledTimes(1);
    });
  });

  describe("start", () => {
    it("返した関数で、購読、期限の予約、進行中の切り替えを取り消す", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      const link = fakeLink();
      env.click(link);
      await env.clock.advanceAsync(0);

      // When
      env.stop();
      env.emitControllerChange();
      await env.clock.advanceAsync(DEADLINE_MS * 2);

      // Then
      expect(env.hasListener()).toBe(false);
      expect(env.controllerListeners.size).toBe(0);
      expect(env.clock.pendingCount()).toBe(0);
      expect(link.follow).not.toHaveBeenCalled();
      expect(link.repeat).not.toHaveBeenCalled();
    });

    it("登録の取得が拒否されても未処理の拒否を出さず、リンクの遷移を止めない", async () => {
      // Given
      const env = setup();
      vi.mocked(env.host.getRegistration).mockRejectedValue(
        new Error("failed"),
      );
      const watcher = watchUnhandledRejections();
      const link = fakeLink();

      try {
        // When
        env.activation.start();
        await env.clock.advanceAsync(0);
        env.click(link);
        await env.clock.advanceAsync(0);
        await watcher.settle();

        // Then
        expect(watcher.reasons).toEqual([]);
        expect(link.block).not.toHaveBeenCalled();
        expect(link.follow).not.toHaveBeenCalled();
        expect(link.repeat).not.toHaveBeenCalled();
        expect(env.registration.skipWaiting).not.toHaveBeenCalled();
        expect(env.persistence.whenPersisted).not.toHaveBeenCalled();
      } finally {
        watcher.stop();
      }
    });

    it("取得の拒否の後、次の機会に取得が成功すれば登録を保持する", async () => {
      // Given
      const env = setup();
      env.registration.waiting = true;
      vi.mocked(env.host.getRegistration).mockRejectedValueOnce(
        new Error("failed"),
      );
      const watcher = watchUnhandledRejections();
      const link = fakeLink();
      env.activation.start();
      await env.clock.advanceAsync(0);

      try {
        // When
        env.activation.pathChanged();
        await env.clock.advanceAsync(0);
        env.click(link);
        await watcher.settle();

        // Then
        expect(env.host.getRegistration).toHaveBeenCalledTimes(2);
        expect(link.block).toHaveBeenCalledTimes(1);
      } finally {
        watcher.stop();
      }
    });

    it("始める前に返った登録は保持しない", async () => {
      // Given
      const env = setup();
      const release = env.withheldRegistration();
      const stop = env.activation.start();
      stop();

      // When
      release();
      await env.clock.advanceAsync(0);
      env.activation.pathChanged();
      env.activation.pathChanged();

      // Then
      expect(env.registration.update).not.toHaveBeenCalled();
    });
  });

  describe("pathChanged", () => {
    it("waitingが無ければ更新を確認する", async () => {
      // Given
      const env = await started();
      env.activation.pathChanged();

      // When
      env.activation.pathChanged();

      // Then
      expect(env.registration.update).toHaveBeenCalledTimes(1);
    });

    it("読み込み時(最初の通知)は更新を確認しない", async () => {
      // Given
      const env = await started();

      // When
      env.activation.pathChanged();

      // Then
      expect(env.registration.update).not.toHaveBeenCalled();
    });

    it("waitingがあるリンク以外の遷移では、合図も更新も保存の待ちもしない", async () => {
      // Given
      const env = await started();
      env.activation.pathChanged();
      env.registration.waiting = true;

      // When
      env.activation.pathChanged();

      // Then
      expect(env.registration.skipWaiting).not.toHaveBeenCalled();
      expect(env.registration.update).not.toHaveBeenCalled();
      expect(env.persistence.whenPersisted).not.toHaveBeenCalled();
    });

    it("登録の取得が拒否されても、未処理の拒否を出さず、更新の確認もしない", async () => {
      // Given
      const env = setup();
      vi.mocked(env.host.getRegistration).mockRejectedValue(
        new Error("failed"),
      );
      const watcher = watchUnhandledRejections();
      env.activation.start();
      await env.clock.advanceAsync(0);

      try {
        // When
        env.activation.pathChanged();
        env.activation.pathChanged();
        await env.clock.advanceAsync(0);
        await watcher.settle();

        // Then
        expect(watcher.reasons).toEqual([]);
        expect(env.registration.update).not.toHaveBeenCalled();
      } finally {
        watcher.stop();
      }
    });

    it("更新の確認が拒否されてもエラーにならない", async () => {
      // Given
      const env = await started();
      env.activation.pathChanged();
      env.registration.update.mockRejectedValue(new Error("offline"));

      // When
      env.activation.pathChanged();
      await env.clock.advanceAsync(0);

      // Then
      expect(env.registration.update).toHaveBeenCalledTimes(1);
    });
  });
});

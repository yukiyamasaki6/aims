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
  let clickListener: ((link: LinkClick) => void) | undefined;
  const links = {
    onClick: vi.fn((listener: (link: LinkClick) => void) => {
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
    click: (link: LinkClick) => clickListener?.(link),
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
  env.activation.pathChanged();
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
    it("waitingがあれば遷移を止め、SKIP_WAITINGを1回送り、controllerchangeの後に遷移する", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;
      const link = fakeLink();

      // When
      env.click(link);
      await env.clock.advanceAsync(0);
      const sentBeforeChange = env.registration.skipWaiting.mock.calls.length;
      const followedBeforeChange = link.follow.mock.calls.length;
      env.emitControllerChange();
      await env.clock.advanceAsync(0);

      // Then
      expect(link.block).toHaveBeenCalledTimes(1);
      expect(sentBeforeChange).toBe(1);
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

    it("登録の保持の前のclickは止めず、遅れて登録が返っても、合図を送らず保存の完了も待たない", async () => {
      // Given
      const env = setup();
      env.registration.waiting = true;
      const release = env.withheldRegistration();
      env.activation.start();
      env.activation.pathChanged();
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
      expect(env.persistence.whenPersisted).not.toHaveBeenCalled();
      expect(env.controllerListeners.size).toBe(0);
    });

    it("controllerchangeの後、遷移の直前に保存を再確認し、追記された保存の完了を待つ", async () => {
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
      env.persistence.whenPersisted.mockReturnValueOnce(
        new Promise<void>(() => {}),
      );
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

    it("有効化待ちと保存の再確認は、クリックから1つの1秒を共有する", async () => {
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
      env.emitControllerChange();
      await env.clock.advanceAsync(0);

      // When
      await env.clock.advanceAsync(99);
      const beforeDeadline = link.follow.mock.calls.length;
      finish();
      await env.clock.advanceAsync(0);

      // Then
      expect(beforeDeadline).toBe(0);
      expect(link.follow).toHaveBeenCalledTimes(1);
    });

    it("有効化待ちを900msで済ませても、1秒を過ぎた保存の再確認では切り替えない", async () => {
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
      env.emitControllerChange();
      await env.clock.advanceAsync(0);

      // When
      await env.clock.advanceAsync(100);
      finish();
      await env.clock.advanceAsync(0);

      // Then
      expect(link.follow).not.toHaveBeenCalled();
      expect(link.repeat).toHaveBeenCalledTimes(1);
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
    it("返した関数で、リンク操作の購読を解除する", async () => {
      // Given
      const env = await started();

      // When
      env.stop();

      // Then
      expect(env.hasListener()).toBe(false);
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
        env.activation.pathChanged();
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
      env.activation.pathChanged();
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
  });

  describe("pathChanged", () => {
    it("waitingが無ければ更新を確認する", async () => {
      // Given
      const env = await started();

      // When
      env.activation.pathChanged();

      // Then
      expect(env.registration.update).toHaveBeenCalledTimes(1);
    });

    it("waitingがあるリンク以外の遷移では、合図も保存の待ちもしないが、更新は確認する", async () => {
      // Given
      const env = await started();
      env.registration.waiting = true;

      // When
      env.activation.pathChanged();

      // Then
      expect(env.registration.skipWaiting).not.toHaveBeenCalled();
      expect(env.persistence.whenPersisted).not.toHaveBeenCalled();
      expect(env.registration.update).toHaveBeenCalledTimes(1);
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
      env.registration.update.mockRejectedValue(new Error("offline"));

      // When
      env.activation.pathChanged();
      await env.clock.advanceAsync(0);

      // Then
      expect(env.registration.update).toHaveBeenCalledTimes(1);
    });
  });
});

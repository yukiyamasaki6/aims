import type { Clock } from "@/lib/clock/contract/clock";

// Service Workerの登録。waitingは、待機中の版が今あるかを同期で返す。
// 例外: skipWaitingは投げない。updateは失敗で拒否することがあり、手続きが無視する。
export type SwRegistration = {
  readonly waiting: boolean;
  // 待機中の版へSKIP_WAITINGを送る。
  skipWaiting(): void;
  update(): Promise<void>;
};

// Service Workerの提供元。未対応の環境では、登録が無い(undefined)として扱う。
// 例外: getRegistrationは拒否することがある。手続きは扱わない(変更前から)。onControllerChangeは投げない。
export type SwHost = {
  getRegistration(): Promise<SwRegistration | undefined>;
  // 制御するService Workerが替わる通知の購読。解除する関数を返す。
  onControllerChange(listener: () => void): () => void;
};

// 内部へ移る通常のリンク操作。
export type LinkClick = {
  // 遷移を止める。
  block(): void;
  // 文書を読み直して遷移先へ進む。
  follow(): void;
  // 同じ操作を押し直して、通常の遷移を進める。押し直しは購読者へ届かない。
  repeat(): void;
};

// リンクの操作の購読。内部の通常のリンク操作でない操作は、nullで届く。解除する関数を返す。
// 例外: どれも投げない。
export type LinkClicks = {
  onClick(listener: (link: LinkClick | null) => void): () => void;
};

// 保存の途中の操作が全て終わるまで解決しない。
type PersistenceWait = {
  whenPersisted(): Promise<void>;
};

export type UpdateActivation = {
  // 登録の保持とリンク操作の購読を始める。返す関数で、購読、進行中の切り替え、期限の予約を止める。
  start(): () => void;
  // 画面の経路が変わった。更新の確認を行う。
  pathChanged(): void;
};

type Dependencies = {
  host: SwHost;
  links: LinkClicks;
  persistence: PersistenceWait;
  clock: Clock;
  // 1回の切り替えがクリックから共有する期限(ms)。
  deadlineMs: number;
};

// 待機中の版を有効にしてから遷移先の文書を取得させる。リンクの操作を止めている間の処理で、クリックから1つの期限を共有する。
// 順序は、保存の完了待ち、SKIP_WAITINGの送信(1回)、controllerchangeの待ち、文書を読み直す直前の保存の再確認。
// 保存の途中の操作を失わないため、文書を読み直す経路だけで保存を待つ。保存が終わらないときは、有効にせずに諦める。
// 期限までに終わらないときはonGiveUp、済めばonSwitchedを呼ぶ。返す関数で、購読と期限の予約を外して中止する(通知は呼ばない)。保存の完了待ちの途中で止めた場合は、保存の完了後に購読と合図の送信まで進む(変更前から)。
function switchToWaiting(
  { host, persistence, clock, deadlineMs }: Dependencies,
  registration: SwRegistration,
  { onSwitched, onGiveUp }: { onSwitched: () => void; onGiveUp: () => void },
): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  let cancelDeadline = () => {};
  const deadline = new Promise<false>((resolve) => {
    cancelDeadline = clock.after(deadlineMs, () => resolve(false));
  });
  const persisted = () =>
    Promise.race([persistence.whenPersisted().then(() => true), deadline]);
  const cleanup = () => {
    cancelDeadline();
    unsubscribe?.();
  };

  const run = async () => {
    if (!(await persisted())) return false;
    const changed = new Promise<true>((resolve) => {
      unsubscribe = host.onControllerChange(() => resolve(true));
    });
    registration.skipWaiting();
    if (!(await Promise.race([changed, deadline]))) return false;
    return persisted();
  };

  void run().then((switched) => {
    cleanup();
    if (cancelled) return;
    if (switched) onSwitched();
    else onGiveUp();
  });

  return () => {
    cancelled = true;
    cleanup();
  };
}

// 待機中の版を、内部リンクの操作の前に有効にしてから遷移させ、遷移先を最初から新しいビルドで表示する。
// 遷移の文書取得を旧版が返すと旧ビルドの枠が出るため、取得の前に切り替える。待機の判定は、保持した登録のwaitingの同期の読み取りだけで行う。
// 待機が無い遷移では更新を確認し、見つかった版は次のリンク操作で切り替える。
// 保持の前の操作、切り替えの失敗、リンク以外の経路(router.push、戻る・進む)では切り替えず、その遷移では更新も試みない。次の遷移で通常どおり判定する。
export function createUpdateActivation(deps: Dependencies): UpdateActivation {
  const { host, links } = deps;
  let active = false;
  let loaded = false;
  let registration: SwRegistration | undefined;
  // 進行中の切り替えの中止。
  let cancel: (() => void) | undefined;
  // 切り替えを諦めて通した遷移と、保持の前に通した遷移でtrue。遷移後の更新の確認を抑え、経路の変化で消す。
  let attempted = false;

  // 登録を未保持なら取得して保持する。保持だけを行い、切り替えも更新もしない。
  function holdRegistration() {
    if (registration) return;
    void host.getRegistration().then((found) => {
      if (active && found) registration = found;
    });
  }

  // 切り替えを諦めたとき、同じ操作を押し直して通常の遷移を進める(旧版が旧ビルドの枠を返す)。
  function giveUp(link: LinkClick) {
    cancel = undefined;
    attempted = true;
    link.repeat();
  }

  // 待機中の版があれば遷移を止めて、切り替えてから文書を取得させる。
  function handleClick(link: LinkClick | null) {
    attempted = false;
    if (!link) return;
    if (!registration) {
      attempted = true;
      return;
    }
    if (!registration.waiting && !cancel) return;
    link.block();
    if (cancel) return;
    cancel = switchToWaiting(deps, registration, {
      onSwitched: () => {
        cancel = undefined;
        link.follow();
      },
      onGiveUp: () => giveUp(link),
    });
  }

  return {
    start() {
      active = true;
      holdRegistration();
      const unsubscribe = links.onClick(handleClick);
      return () => {
        active = false;
        unsubscribe();
        cancel?.();
        cancel = undefined;
      };
    },
    // 経路の変化のあと、待機が無い遷移で更新を確認する。通した遷移(attempted)では確認しない。
    pathChanged() {
      const navigated = loaded;
      loaded = true;
      holdRegistration();
      if (attempted) {
        attempted = false;
        return;
      }
      if (navigated && registration && !registration.waiting) {
        registration.update().catch(() => {});
      }
    },
  };
}

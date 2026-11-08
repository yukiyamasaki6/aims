import type { SwHost, SwRegistration } from "../application/update-activation";

function registrationOf(
  registration: ServiceWorkerRegistration,
): SwRegistration {
  return {
    get waiting() {
      return registration.waiting !== null;
    },
    skipWaiting: () =>
      registration.waiting?.postMessage({ type: "SKIP_WAITING" }),
    update: async () => {
      await registration.update();
    },
  };
}

// ブラウザのService Workerの提供元。未対応の環境では、取得が拒否される。
export function createBrowserServiceWorker(): SwHost {
  return {
    async getRegistration() {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration ? registrationOf(registration) : undefined;
    },
    onControllerChange(listener) {
      const container = navigator.serviceWorker;
      container.addEventListener("controllerchange", listener);
      return () => container.removeEventListener("controllerchange", listener);
    },
  };
}

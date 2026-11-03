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

// ブラウザのService Workerの提供元。未対応の環境は、登録が無い(undefined)として扱う。
export function createBrowserServiceWorker(): SwHost {
  return {
    async getRegistration() {
      if (!("serviceWorker" in navigator)) return undefined;
      const registration = await navigator.serviceWorker.getRegistration();
      return registration ? registrationOf(registration) : undefined;
    },
    onControllerChange(listener) {
      if (!("serviceWorker" in navigator)) return () => {};
      const container = navigator.serviceWorker;
      container.addEventListener("controllerchange", listener);
      return () => container.removeEventListener("controllerchange", listener);
    },
  };
}

import type { SerwistPlugin } from "serwist";
import { isShellUrl } from "../domain/offline-routes";

// cacheWillUpdateを持つプラグインは、Serwistの既定の保存条件(ステータス400以上は
// 保存せずインストールを失敗させる)を置き換えるため、同じ拒否をここで行う。
// 失敗はインストールを失敗させ、壊れた応答が次のビルドまで配られるのを防ぐ。
// /__shell/*がリダイレクトされた応答(未認証の/signinなど)も枠として保存しない。
export const precacheGuard: SerwistPlugin = {
  cacheWillUpdate: async ({ request, response }) => {
    if (!response.ok) {
      throw new Error(`${request.url}の応答(${response.status})が不正です。`);
    }
    if (response.redirected && isShellUrl(new URL(request.url).pathname)) {
      throw new Error(`${request.url}がリダイレクトされました。`);
    }
    return response;
  },
};

import type { SerwistPlugin } from "serwist";

// cacheWillUpdateを持つプラグインは、Serwistの既定の保存条件(ステータス400以上は
// 保存せずインストールを失敗させる)を置き換えるため、同じ拒否をここで行う。
// 失敗はインストールを失敗させ、壊れた応答が次のビルドまで配られるのを防ぐ。
export const precacheGuard: SerwistPlugin = {
  cacheWillUpdate: async ({ request, response }) => {
    if (!response.ok) {
      throw new Error(`${request.url}の応答(${response.status})が不正です。`);
    }
    return response;
  },
};

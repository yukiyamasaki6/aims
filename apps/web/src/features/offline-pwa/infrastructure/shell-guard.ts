import type { SerwistPlugin } from "serwist";
import { isShellUrl } from "../domain/offline-routes";

// /__shell/*がリダイレクトされた応答(未認証の/signinなど)を枠として
// 保存しない。インストールを失敗させ、壊れた枠が配られるのを防ぐ。
export const shellFrameGuard: SerwistPlugin = {
  cacheWillUpdate: async ({ request, response }) => {
    if (response.redirected && isShellUrl(new URL(request.url).pathname)) {
      throw new Error(`${request.url}がリダイレクトされました。`);
    }
    return response;
  },
};

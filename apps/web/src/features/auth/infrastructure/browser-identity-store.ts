import type { IdentityReader } from "../application/identity-reader";
import type { IdentityWriter } from "../application/local-identity";

const STORAGE_KEY = "aims:local-user-id";

// オフライン中はサーバーに問い合わせられないため、認証サービスのセッション(JWT)の有効期限とは無関係に
// 「この端末に最後にサインインしていたのは誰か」を保持する。
// オフライン中にアクセストークンが失効しても、それだけで自分のローカルデータ(未同期の入力など)にアクセスできなくなってはならない。
// 他の機能(ラウンドの参照データ、同期の開始)は、入口から`IdentityReader`の型で受け取って使う。
export function createBrowserIdentityStore(): IdentityWriter & IdentityReader {
  return {
    // この端末に最後にサインインした利用者(いなければnull)。保存先が使えないときもnull。例外は投げない。
    read: () => {
      // サーバーでの描画中に誤って呼ばれた場合の防御。
      if (typeof window === "undefined") return null;
      try {
        return window.localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    },
    write: (userId) => {
      // 読み出し同様、サーバーでの描画中の呼び出しに対する防御。
      if (typeof window === "undefined") return;
      try {
        if (userId) {
          window.localStorage.setItem(STORAGE_KEY, userId);
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // プライベートブラウジングなどでlocalStorageが使えない場合は何もできない。
      }
    },
  };
}

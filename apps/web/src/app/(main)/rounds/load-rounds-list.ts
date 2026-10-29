import type {
  LoadedRoundsList,
  RoundListItem,
  RoundsStore,
} from "@/features/rounds/application/rounds-store";
import type { FetchResult } from "@/features/rounds/domain/fetch-result";

// サーバーの一覧と、端末の入力中のラウンドおよび削除済みのラウンドを返す。
// 一覧の取得は、この画面の関数(`fetchServerList`)で行う。入力中と端末が保持するラウンドの一括の取得と、端末の記録への反映の時点は、同期が決める。
// ページ・フィルタ・ソートの条件は、`fetchServerList`のクエリに足す。
export function loadRoundsList(
  store: RoundsStore,
  fetchServerList: () => Promise<FetchResult<RoundListItem[]>>,
): Promise<FetchResult<LoadedRoundsList>> {
  return store.loadList(fetchServerList);
}

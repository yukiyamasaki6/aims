import { Strategy, type StrategyHandler } from "serwist";

export type PrecachedFrameDeps = {
  // ナビゲーションのpathnameに対応する枠の配布URL。無ければnull。
  frameUrlOf(pathname: string): string | null;
  matchPrecache(url: string): Promise<Response | undefined>;
};

// 画面の枠(/rounds、/rounds/new、/rounds/<任意のID>)のナビゲーションは、
// ユーザーデータを含まない静的なHTMLなので、プリキャッシュから返す
// (キャッシュ優先)。枠が未格納ならネットワークへ落とし、通信にも失敗した
// ときはfallbacksが/offlineを返す。fallbacksのプラグインはStrategyの
// インスタンスのハンドラにしか付かないため、Strategyを継承する。
export class PrecachedFrame extends Strategy {
  readonly #deps: PrecachedFrameDeps;

  constructor(deps: PrecachedFrameDeps) {
    super();
    this.#deps = deps;
  }

  async _handle(request: Request, handler: StrategyHandler) {
    // 枠の規則のmatcher(runtime-caching.ts)が、枠があるナビゲーションにだけこのハンドラを選ぶ。
    const frameUrl = this.#deps.frameUrlOf(
      new URL(request.url).pathname,
    ) as string;
    const frame = await this.#deps.matchPrecache(frameUrl);
    return frame ?? handler.fetch(request);
  }
}

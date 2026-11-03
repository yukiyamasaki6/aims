import type { StrategyHandler } from "serwist";
import { describe, expect, it, vi } from "vitest";
import { PrecachedFrame } from "./precached-frame";

function setup(frameUrl: string | null, cached: Response | undefined) {
  const matchPrecache = vi.fn(async () => cached);
  const frame = new PrecachedFrame({
    frameUrlOf: () => frameUrl,
    matchPrecache,
  });
  const network = new Response("network");
  const fetchStub = vi.fn(async () => network);
  const handle = () =>
    frame._handle(new Request("http://localhost/rounds"), {
      fetch: fetchStub,
    } as unknown as StrategyHandler);
  return { handle, matchPrecache, fetchStub, network };
}

describe("PrecachedFrame", () => {
  it("枠が格納されていれば、プリキャッシュの枠を返し、ネットワークへ取りに行かない", async () => {
    // Given
    const cached = new Response("frame");
    const { handle, matchPrecache, fetchStub } = setup(
      "/__shell/rounds",
      cached,
    );

    // When
    const response = await handle();

    // Then
    expect(response).toBe(cached);
    expect(matchPrecache).toHaveBeenCalledExactlyOnceWith("/__shell/rounds");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("枠が未格納なら、ネットワークから取得する", async () => {
    // Given
    const { handle, network } = setup("/__shell/rounds", undefined);

    // When
    const response = await handle();

    // Then
    expect(response).toBe(network);
  });

  it("枠のないパスは、プリキャッシュを引かずにネットワークから取得する", async () => {
    // Given
    const { handle, matchPrecache, network } = setup(null, new Response("x"));

    // When
    const response = await handle();

    // Then
    expect(response).toBe(network);
    expect(matchPrecache).not.toHaveBeenCalled();
  });
});

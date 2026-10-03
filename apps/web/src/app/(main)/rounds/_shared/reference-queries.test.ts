import { describe, expect, it, vi } from "vitest";
import { getGlobalTargetFaces } from "./reference-queries";
import { TARGET_FACE_SELECT } from "./reference-query-constants";

// Supabaseのクエリビルダーはメソッドチェーンでフィルタを積み上げ、
// awaitした時点でthenが呼ばれてPromiseとして解決する。この形を模す。
function createQueryChain(result: { data: unknown; error: unknown }) {
  const chain = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    // biome-ignore lint/suspicious/noThenProperty: Supabaseのクエリビルダーの契約（thenable）を模している
    then: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  };
  return chain;
}

describe("getGlobalTargetFaces", () => {
  it("target_facesを正しい条件・並び順で取得する", async () => {
    const chain = createQueryChain({ data: [{ id: "face-1" }], error: null });

    const result = await getGlobalTargetFaces(chain as never);

    expect(chain.from).toHaveBeenCalledWith("target_faces");
    expect(chain.select).toHaveBeenCalledWith(TARGET_FACE_SELECT);
    expect(chain.is).toHaveBeenCalledWith("owner_id", null);
    expect(chain.order).toHaveBeenNthCalledWith(1, "format", {
      ascending: false,
    });
    expect(chain.order).toHaveBeenNthCalledWith(2, "size", {
      ascending: false,
    });
    expect(chain.order).toHaveBeenNthCalledWith(3, "name");
    expect(result).toEqual([{ id: "face-1" }]);
  });

  it("取得に失敗した場合はエラーを投げる", async () => {
    const error = new Error("query failed");
    const chain = createQueryChain({ data: null, error });

    await expect(getGlobalTargetFaces(chain as never)).rejects.toBe(error);
  });
});

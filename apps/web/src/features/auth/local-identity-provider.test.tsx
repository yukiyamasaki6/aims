import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalIdentityProvider } from "./local-identity-provider";

// createClient（client.test.tsで検証済み）とinitLocalIdentity（local-identity.test.tsで検証済み）は、このテストを削除してもテスト対象以外のカバレッジに影響しないように、別モジュールとの境界としてモックする。
const supabase = vi.hoisted(() => ({
  client: { fake: "client" },
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: supabase.createClient,
}));

const identity = vi.hoisted(() => ({
  cleanup: vi.fn(),
  initLocalIdentity: vi.fn(),
}));
vi.mock("@/features/auth/local-identity", () => ({
  initLocalIdentity: identity.initLocalIdentity,
}));

beforeEach(() => {
  vi.clearAllMocks();
  supabase.createClient.mockReturnValue(supabase.client);
  identity.initLocalIdentity.mockReturnValue(identity.cleanup);
});

describe("LocalIdentityProvider", () => {
  describe("マウント", () => {
    it("Supabaseクライアントを生成し、そのクライアントで端末ローカルの識別の記録を開始する", () => {
      // Given
      const element = <LocalIdentityProvider />;

      // When
      render(element);

      // Then
      expect(supabase.createClient).toHaveBeenCalledTimes(1);
      expect(identity.initLocalIdentity).toHaveBeenCalledExactlyOnceWith(
        supabase.client,
      );
      expect(identity.cleanup).not.toHaveBeenCalled();
    });

    it("何も表示しない", () => {
      // Given
      const element = <LocalIdentityProvider />;

      // When
      const { container } = render(element);

      // Then
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("アンマウント", () => {
    it("記録の開始時に返された解除処理を呼び出す", () => {
      // Given
      const { unmount } = render(<LocalIdentityProvider />);

      // When
      unmount();

      // Then
      expect(identity.cleanup).toHaveBeenCalledTimes(1);
    });
  });
});

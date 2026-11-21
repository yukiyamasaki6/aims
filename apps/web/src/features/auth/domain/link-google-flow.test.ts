import { describe, expect, it } from "vitest";
import type { AccountSummary } from "./account-summary";
import {
  beginAddGoogle,
  beginGoogleLinkReturn,
  beginRemoveGoogle,
  initialLinkGoogleFlow,
  type LinkGoogleFlow,
  linkGoogleReducer,
} from "./link-google-flow";

const linked: AccountSummary = {
  userId: "user-1",
  email: "archer@example.test",
  google: { id: "identity-google", email: "archer@gmail.example.test" },
};
const unlinked: AccountSummary = { ...linked, google: null };

const idle = initialLinkGoogleFlow(unlinked);
const adding: LinkGoogleFlow = { ...idle, pending: "adding" };
const removing: LinkGoogleFlow = {
  ...initialLinkGoogleFlow(linked),
  pending: "removing",
};
const confirming: LinkGoogleFlow = {
  ...initialLinkGoogleFlow(linked),
  confirming: true,
};
const loading = initialLinkGoogleFlow(null);

describe("beginAddGoogle", () => {
  it("初期かつオンラインなら、追加中にして依頼を返し、以前の失敗を消す", () => {
    // Given
    const previous: LinkGoogleFlow = { ...idle, error: "google_auth_failed" };

    // When
    const result = beginAddGoogle(previous, { offline: false });

    // Then
    expect(result.request).toBe(true);
    expect(result.state).toEqual({ ...idle, pending: "adding" });
  });

  it("実行中と読み込み中は、オフラインかどうかによらず、状態を変えず依頼を返さない", () => {
    // Given
    const flows = [adding, removing, loading];

    // When
    const results = flows.flatMap((flow) =>
      [false, true].map((offline) => beginAddGoogle(flow, { offline })),
    );

    // Then
    expect(results.map((result) => result.request)).toEqual(
      Array(6).fill(null),
    );
    expect(results.map((result) => result.state)).toEqual(
      flows.flatMap((flow) => [flow, flow]),
    );
  });

  it("解除の確認中は、追加を受け付けない", () => {
    // Given
    // When
    const result = beginAddGoogle(confirming, { offline: false });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toBe(confirming);
  });

  it("オフラインなら、依頼を返さず、オフラインの理由を載せる", () => {
    // Given
    // When
    const result = beginAddGoogle(idle, { offline: true });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toEqual({ ...idle, error: "offline" });
  });
});

describe("beginGoogleLinkReturn", () => {
  it("追加中にして依頼を返す", () => {
    // Given
    // When
    const result = beginGoogleLinkReturn(idle);

    // Then
    expect(result.request).toBe(true);
    expect(result.state.pending).toBe("adding");
  });

  it("実行中は、開始せず、状態を変えない", () => {
    // Given
    // When
    const result = beginGoogleLinkReturn(removing);

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toBe(removing);
  });
});

describe("beginRemoveGoogle", () => {
  it("オンラインなら、確認を経て、解除中にして依頼を返す", () => {
    // Given
    // When
    const result = beginRemoveGoogle(confirming, { offline: false });

    // Then
    expect(result.request).toBe(true);
    expect(result.state.pending).toBe("removing");
  });

  it("実行中は、オフラインかどうかによらず、状態を変えず依頼を返さない", () => {
    // Given
    const flows = [adding, removing];

    // When
    const results = flows.flatMap((flow) =>
      [false, true].map((offline) => beginRemoveGoogle(flow, { offline })),
    );

    // Then
    expect(results.map((result) => result.request)).toEqual(
      Array(4).fill(null),
    );
    expect(results.map((result) => result.state)).toEqual(
      flows.flatMap((flow) => [flow, flow]),
    );
  });

  it("読み込み中は、オフラインかどうかによらず、状態を変えず依頼を返さない", () => {
    // Given
    // When
    const results = [false, true].map((offline) =>
      beginRemoveGoogle(loading, { offline }),
    );

    // Then
    expect(results.map((result) => result.request)).toEqual([null, null]);
    expect(results.map((result) => result.state)).toEqual([loading, loading]);
  });

  it("オフラインなら、確認を閉じて、依頼を返さずオフラインの理由を載せる", () => {
    // Given
    // When
    const result = beginRemoveGoogle(confirming, { offline: true });

    // Then
    expect(result.request).toBeNull();
    expect(result.state).toMatchObject({
      confirming: false,
      pending: null,
      error: "offline",
    });
  });
});

describe("linkGoogleReducer", () => {
  describe("解除の確認", () => {
    it("結び付きがあり実行中でなければ、確認を開く", () => {
      // Given
      const flow = initialLinkGoogleFlow(linked);

      // When
      const next = linkGoogleReducer(flow, { type: "confirmRequested" });

      // Then
      expect(next.confirming).toBe(true);
    });

    it("結び付きが無いか、実行中なら、確認を開かない", () => {
      // Given
      const flows = [
        idle,
        initialLinkGoogleFlow(null),
        { ...removing, account: linked },
      ];

      // When
      const results = flows.map((flow) =>
        linkGoogleReducer(flow, { type: "confirmRequested" }),
      );

      // Then
      expect(results).toEqual(flows);
    });

    it("確認を取り消すと、確認を閉じて初期へ戻る", () => {
      // Given
      // When
      const next = linkGoogleReducer(confirming, { type: "confirmCancelled" });

      // Then
      expect(next).toEqual(initialLinkGoogleFlow(linked));
    });

    it("解除中は、確認を閉じない", () => {
      // Given
      const flow: LinkGoogleFlow = { ...removing, confirming: true };

      // When
      const next = linkGoogleReducer(flow, { type: "confirmCancelled" });

      // Then
      expect(next).toBe(flow);
    });

    it("確認を開いた後に確定すると、解除中になる", () => {
      // Given
      const opened = linkGoogleReducer(initialLinkGoogleFlow(linked), {
        type: "confirmRequested",
      });

      // When
      const result = beginRemoveGoogle(opened, { offline: false });

      // Then
      expect(result.state).toMatchObject({
        pending: "removing",
        confirming: true,
      });
    });
  });

  describe("失敗", () => {
    it.each<[string, LinkGoogleFlow["error"]]>([
      ["追加の失敗", "google_auth_failed"],
      ["別のアカウントで使用中", "google_link_taken"],
      ["解除の失敗", "google_unlink_failed"],
    ])("%sは種類を持って載り、次の開始で消える", (_name, failure) => {
      // Given
      const flow: LinkGoogleFlow = { ...adding };

      // When
      const failed = linkGoogleReducer(flow, {
        type: "finished",
        account: null,
        failure,
      });
      const restarted = [
        beginAddGoogle(failed, { offline: false }),
        beginRemoveGoogle(failed, { offline: false }),
        beginGoogleLinkReturn(failed),
      ].map((result) => result.state.error);

      // Then
      expect(failed.error).toBe(failure);
      expect(restarted).toEqual([null, null, null]);
    });
  });

  describe("事実の反映", () => {
    it("readは、概要だけを置き換える", () => {
      // Given
      const flow = { ...adding, error: "google_auth_failed" as const };

      // When
      const next = linkGoogleReducer(flow, { type: "read", account: linked });

      // Then
      expect(next).toEqual({ ...flow, account: linked });
    });

    it("finishedは、概要と失敗を反映し、実行中と確認を解く", () => {
      // Given
      const flow: LinkGoogleFlow = { ...removing, confirming: true };

      // When
      const next = linkGoogleReducer(flow, {
        type: "finished",
        account: unlinked,
        failure: null,
      });

      // Then
      expect(next).toEqual({
        account: unlinked,
        pending: null,
        confirming: false,
        error: null,
      });
    });

    it("finishedで概要を読めなかったときは、前の概要を保ち、失敗を載せる", () => {
      // Given
      // When
      const next = linkGoogleReducer(adding, {
        type: "finished",
        account: null,
        failure: "google_unlink_failed",
      });

      // Then
      expect(next).toMatchObject({
        account: unlinked,
        pending: null,
        error: "google_unlink_failed",
      });
    });

    it("restoredは、追加中だけを解く", () => {
      // Given
      // When
      const results = [adding, removing, idle].map((flow) =>
        linkGoogleReducer(flow, { type: "restored" }),
      );

      // Then
      expect(results).toEqual([idle, removing, idle]);
    });
  });
});

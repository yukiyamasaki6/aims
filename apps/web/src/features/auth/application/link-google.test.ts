import { describe, expect, it } from "vitest";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type { AccountSummary } from "../domain/account-summary";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  initialLinkGoogleFlow,
  type LinkGoogleEvent,
  type LinkGoogleFlow,
  linkGoogleReducer,
} from "../domain/link-google-flow";
import { createFakeAccountSummaryStore } from "./account-summary-store-test-helpers";
import type { CallResult } from "./call-result";
import { createLinkGoogle } from "./link-google";
import {
  createFakeEmailIdentityPreparation,
  createFakeLinkGoogleAuthenticator,
  readingOf,
} from "./link-google-test-helpers";
import { screenHarness } from "./screen-view-test-helpers";

const RETURN_PATH = "/rounds?link-google=1#settings/account";
const MARK = "link-google=1";

const unlinked: AccountSummary = {
  userId: "user-1",
  email: "archer@example.test",
  google: null,
};
const linked: AccountSummary = {
  ...unlinked,
  google: { id: "identity-google", email: "archer@gmail.example.test" },
};

const failed = (failure: AuthFailure): CallResult => ({
  kind: "failed",
  failure,
});

function setup({
  offline = false,
  stored = unlinked,
  reading = readingOf(unlinked),
}: {
  offline?: boolean;
  stored?: AccountSummary | null;
  reading?: Parameters<typeof createFakeLinkGoogleAuthenticator>[0];
} = {}) {
  const authenticator = createFakeLinkGoogleAuthenticator(reading);
  const emailIdentity = createFakeEmailIdentityPreparation();
  const summaries = createFakeAccountSummaryStore(stored);
  const linkGoogle = createLinkGoogle({
    authenticator,
    emailIdentity,
    summaries,
    connectivity: createFakeConnectivity(offline),
  });
  const harness = screenHarness<LinkGoogleFlow, LinkGoogleEvent>(
    linkGoogleReducer,
  );
  return {
    linkGoogle,
    authenticator,
    emailIdentity,
    summaries,
    ...harness,
    viewOf: (account: AccountSummary | null = stored) =>
      harness.viewOf(initialLinkGoogleFlow(account)),
  };
}

describe("Googleアカウントの追加・削除の手続き", () => {
  describe("記録", () => {
    it("行の初期表示は、記録の概要を返す", () => {
      // Given
      const { linkGoogle } = setup({ stored: linked });

      // When
      const result = linkGoogle.stored();

      // Then
      expect(result).toEqual(linked);
    });
  });

  describe("追加の開始", () => {
    it("オンラインなら、「追加」の印つきの戻り先でGoogleの認証を始め、追加中にする", async () => {
      // Given
      const { linkGoogle, authenticator, viewOf } = setup();
      const view = viewOf();

      // When
      await linkGoogle.start(view);

      // Then
      expect(authenticator.startGoogleLink).toHaveBeenCalledExactlyOnceWith({
        returnPath: RETURN_PATH,
      });
      expect(view.observedState.pending).toBe("adding");
    });

    it("オフラインなら、理由を示して始めない", async () => {
      // Given
      const { linkGoogle, authenticator, viewOf } = setup({ offline: true });
      const view = viewOf();

      // When
      await linkGoogle.start(view);

      // Then
      expect(authenticator.startGoogleLink).not.toHaveBeenCalled();
      expect(view.observedState).toMatchObject({
        pending: null,
        error: "offline",
      });
    });

    it("追加中の再押下は、認証を呼ばず、何も変えない", async () => {
      // Given
      const { linkGoogle, authenticator, events, viewOf } = setup();
      const view = viewOf();
      await linkGoogle.start(view);
      const before = view.observedState;

      // When
      await linkGoogle.start(view);

      // Then
      expect(authenticator.startGoogleLink).toHaveBeenCalledOnce();
      expect(events).toEqual([]);
      expect(view.observedState).toBe(before);
    });

    it("開始が失敗したら、理由を示して追加中を解く", async () => {
      // Given
      const { linkGoogle, authenticator, viewOf } = setup();
      authenticator.startGoogleLink.mockResolvedValue(failed(UNREACHABLE));
      const view = viewOf();

      // When
      await linkGoogle.start(view);

      // Then
      expect(view.observedState).toMatchObject({
        pending: null,
        error: "unreachable",
      });
    });
  });

  describe("戻りの預かり", () => {
    it("追加の戻りだけを預かって真を返し、サインインの戻りと戻りなしは偽を返す", () => {
      // Given
      const { linkGoogle } = setup();

      // When
      const results = [`?${MARK}&code=x`, "?code=x", ""].map((search) =>
        linkGoogle.capture(search),
      );

      // Then
      expect(results).toEqual([true, false, false]);
    });

    it("預かった戻りは1回だけ処理し、次の読み込みでは読み直しだけを行う", async () => {
      // Given
      const { linkGoogle, authenticator, viewOf } = setup({
        reading: readingOf(linked),
      });
      linkGoogle.capture(`?${MARK}&code=x`);
      await linkGoogle.resume(viewOf());
      authenticator.readAccount.mockClear();
      const view = viewOf();

      // When
      await linkGoogle.resume(view);

      // Then
      expect(authenticator.readAccount).toHaveBeenCalledOnce();
      expect(view.observedState.notice).toBeNull();
    });
  });

  describe("codeの戻り", () => {
    it("交換せず、読み直して結び付いていれば追加した旨を示し、記録と行を読み直した内容にする", async () => {
      // Given
      const { linkGoogle, summaries, viewOf } = setup({
        reading: readingOf(linked),
      });
      linkGoogle.capture(`?${MARK}&code=x`);
      const view = viewOf();

      // When
      await linkGoogle.resume(view);

      // Then
      expect(view.observedState).toEqual({
        account: linked,
        pending: null,
        confirming: false,
        notice: "added",
        error: null,
      });
      expect(summaries.write).toHaveBeenCalledExactlyOnceWith(linked);
    });

    it("読み直しでGoogleが無ければ、成功と示さず、読み直した行だけを示す", async () => {
      // Given
      const { linkGoogle, viewOf } = setup({
        stored: linked,
        reading: readingOf(unlinked),
      });
      linkGoogle.capture(`?${MARK}&code=x`);
      const view = viewOf();

      // When
      await linkGoogle.resume(view);

      // Then
      expect(view.observedState).toMatchObject({
        account: unlinked,
        notice: null,
        error: null,
      });
    });

    it("読み直せないときは、成功と示さず、記録の行のまま通信エラーを示す", async () => {
      // Given
      const { linkGoogle, summaries, viewOf } = setup({
        reading: { kind: "failed", failure: UNREACHABLE },
      });
      linkGoogle.capture(`?${MARK}&code=x`);
      const view = viewOf();

      // When
      await linkGoogle.resume(view);

      // Then
      expect(view.observedState).toMatchObject({
        account: unlinked,
        pending: null,
        notice: null,
        error: "unreachable",
      });
      expect(summaries.write).not.toHaveBeenCalled();
    });

    it("戻った時点でサインインが切れていれば、知らせも記録の書き換えも無い", async () => {
      // Given
      const { linkGoogle, summaries, events, viewOf } = setup({
        reading: { kind: "lost" },
      });
      linkGoogle.capture(`?${MARK}&code=x`);

      // When
      await linkGoogle.resume(viewOf());

      // Then
      expect(events).toEqual([]);
      expect(summaries.write).not.toHaveBeenCalled();
    });
  });

  describe("失敗の戻り", () => {
    it.each<[string, string, string]>([
      [
        "取り消し",
        `?${MARK}&error=access_denied&error_description=denied`,
        "google_link_cancelled",
      ],
      [
        "別のアカウントで使用中",
        `?${MARK}&error=server_error&error_code=identity_already_exists`,
        "google_link_taken",
      ],
      ["その他の失敗", `?${MARK}&error=server_error`, "other"],
    ])(
      "%sの戻りは、各理由を示し、読み直さず、行を変えない",
      async (_name, search, kind) => {
        // Given
        const { linkGoogle, authenticator, summaries, viewOf } = setup();
        linkGoogle.capture(search);
        const view = viewOf();

        // When
        await linkGoogle.resume(view);

        // Then
        expect(view.observedState).toEqual({
          account: unlinked,
          pending: null,
          confirming: false,
          notice: null,
          error: kind,
        });
        expect(authenticator.readAccount).not.toHaveBeenCalled();
        expect(summaries.write).not.toHaveBeenCalled();
      },
    );
  });

  describe("戻りの無い読み込み", () => {
    it("オンラインなら、読み直して記録を更新し、行を読み直した内容にする", async () => {
      // Given
      const { linkGoogle, summaries, viewOf } = setup({
        reading: readingOf(linked),
      });
      const view = viewOf();

      // When
      await linkGoogle.resume(view);

      // Then
      expect(view.observedState.account).toEqual(linked);
      expect(summaries.write).toHaveBeenCalledExactlyOnceWith(linked);
    });

    it("オフラインなら、読み直さない", async () => {
      // Given
      const { linkGoogle, authenticator, viewOf } = setup({ offline: true });

      // When
      await linkGoogle.resume(viewOf());

      // Then
      expect(authenticator.readAccount).not.toHaveBeenCalled();
    });

    it("読み直せなくても、行も知らせも変えない", async () => {
      // Given
      const { linkGoogle, events, viewOf } = setup({
        reading: { kind: "failed", failure: UNREACHABLE },
      });
      const view = viewOf();

      // When
      await linkGoogle.resume(view);

      // Then
      expect(events).toEqual([]);
      expect(view.observedState).toEqual(initialLinkGoogleFlow(unlinked));
    });
  });

  describe("削除", () => {
    it("メールの手段の準備の後に、行に示したGoogleの手段を解除し、読み直した行を記録して削除した旨を示す", async () => {
      // Given
      const { linkGoogle, authenticator, emailIdentity, summaries, viewOf } =
        setup({ stored: linked, reading: readingOf(unlinked) });
      const order: string[] = [];
      emailIdentity.ensure.mockImplementation(async () => {
        order.push("ensure");
        return { kind: "accepted" };
      });
      authenticator.unlinkGoogle.mockImplementation(async () => {
        order.push("unlink");
        return { kind: "accepted" };
      });
      const view = viewOf();

      // When
      await linkGoogle.remove({ identityId: "identity-google" }, view);

      // Then
      expect(order).toEqual(["ensure", "unlink"]);
      expect(authenticator.unlinkGoogle).toHaveBeenCalledExactlyOnceWith(
        "identity-google",
      );
      expect(summaries.write).toHaveBeenCalledExactlyOnceWith(unlinked);
      expect(view.observedState).toEqual({
        account: unlinked,
        pending: null,
        confirming: false,
        notice: "removed",
        error: null,
      });
    });

    it("準備が失敗したら、解除せず、Googleは結び付いたまま、理由を示す", async () => {
      // Given
      const { linkGoogle, authenticator, emailIdentity, viewOf } = setup({
        stored: linked,
      });
      emailIdentity.ensure.mockResolvedValue(failed({ kind: "other" }));
      const view = viewOf();

      // When
      await linkGoogle.remove({ identityId: "identity-google" }, view);

      // Then
      expect(authenticator.unlinkGoogle).not.toHaveBeenCalled();
      expect(view.observedState).toMatchObject({
        account: linked,
        pending: null,
        notice: null,
        error: "other",
      });
    });

    it("解除が拒否されたら、結び付いたまま、理由を示す", async () => {
      // Given
      const { linkGoogle, authenticator, viewOf } = setup({
        stored: linked,
        reading: readingOf(linked),
      });
      authenticator.unlinkGoogle.mockResolvedValue(failed({ kind: "other" }));
      const view = viewOf();

      // When
      await linkGoogle.remove({ identityId: "identity-google" }, view);

      // Then
      expect(authenticator.readAccount).not.toHaveBeenCalled();
      expect(view.observedState).toMatchObject({
        account: linked,
        notice: null,
        error: "other",
      });
    });

    it("解除の結果が分からないときは、成功と示さず、読み直した行と通信エラーを示す", async () => {
      // Given
      const { linkGoogle, authenticator, summaries, viewOf } = setup({
        stored: linked,
        reading: readingOf(unlinked),
      });
      authenticator.unlinkGoogle.mockResolvedValue(failed(UNREACHABLE));
      const view = viewOf();

      // When
      await linkGoogle.remove({ identityId: "identity-google" }, view);

      // Then
      expect(summaries.write).toHaveBeenCalledExactlyOnceWith(unlinked);
      expect(view.observedState).toMatchObject({
        account: unlinked,
        notice: null,
        error: "unreachable",
      });
    });

    it("解除の結果が分からず読み直しも失敗したら、記録の行のまま通信エラーを示す", async () => {
      // Given
      const { linkGoogle, authenticator, viewOf } = setup({
        stored: linked,
        reading: { kind: "failed", failure: UNREACHABLE },
      });
      authenticator.unlinkGoogle.mockResolvedValue(failed(UNREACHABLE));
      const view = viewOf();

      // When
      await linkGoogle.remove({ identityId: "identity-google" }, view);

      // Then
      expect(view.observedState).toMatchObject({
        account: linked,
        notice: null,
        error: "unreachable",
      });
    });

    it("解除の後にサインインが切れていれば、知らせも記録の書き換えも無い", async () => {
      // Given
      const { linkGoogle, summaries, events, viewOf } = setup({
        stored: linked,
        reading: { kind: "lost" },
      });

      // When
      await linkGoogle.remove({ identityId: "identity-google" }, viewOf());

      // Then
      expect(events).toEqual([]);
      expect(summaries.write).not.toHaveBeenCalled();
    });

    it("オフラインなら、何も送らず、オフラインの案内を示す", async () => {
      // Given
      const { linkGoogle, authenticator, emailIdentity, viewOf } = setup({
        offline: true,
        stored: linked,
      });
      const view = viewOf();

      // When
      await linkGoogle.remove({ identityId: "identity-google" }, view);

      // Then
      expect(emailIdentity.ensure).not.toHaveBeenCalled();
      expect(authenticator.unlinkGoogle).not.toHaveBeenCalled();
      expect(view.observedState.error).toBe("offline");
    });

    it("実行中の再押下は、何も送らず、状態を変えない", async () => {
      // Given
      const { linkGoogle, emailIdentity, events, viewOf } = setup({
        stored: linked,
      });
      const view = viewOf();
      await linkGoogle.start(view);
      const before = view.observedState;

      // When
      await linkGoogle.remove({ identityId: "identity-google" }, view);

      // Then
      expect(emailIdentity.ensure).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(view.observedState).toBe(before);
    });
  });

  describe("画面の離脱", () => {
    it("開始の失敗を返されても、離脱後は表示を変えない", async () => {
      // Given
      const { linkGoogle, authenticator, screen, events, viewOf } = setup();
      const response = Promise.withResolvers<CallResult>();
      authenticator.startGoogleLink.mockReturnValue(response.promise);
      const running = linkGoogle.start(viewOf());
      screen.mounted = false;

      // When
      response.resolve(failed(UNREACHABLE));
      await running;

      // Then
      expect(events).toEqual([]);
    });

    it("削除の途中で離脱したら、完了しても表示を変えない", async () => {
      // Given
      const { linkGoogle, emailIdentity, screen, events, viewOf } = setup({
        stored: linked,
      });
      const response = Promise.withResolvers<CallResult>();
      emailIdentity.ensure.mockReturnValue(response.promise);
      const running = linkGoogle.remove(
        { identityId: "identity-google" },
        viewOf(),
      );
      screen.mounted = false;

      // When
      response.resolve({ kind: "accepted" });
      await running;

      // Then
      expect(events).toEqual([]);
    });
  });
});

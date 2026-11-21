import { describe, expect, it, vi } from "vitest";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";
import {
  type GoogleSignInEvent,
  type GoogleSignInFlow,
  googleSignInReducer,
  initialGoogleSignInFlow,
} from "../domain/google-sign-in-flow";
import type { CallResult } from "./call-result";
import { createFakePageAddress } from "./fake-page-address-test-helpers";
import { createGoogleSignIn } from "./google-sign-in";
import { createFakeGoogleSignInAuthenticator } from "./google-sign-in-test-helpers";
import { screenHarness } from "./screen-view-test-helpers";

const RETURN_TO = "%2Frounds%2Fhistory%23settings%2Faccount";
const RETURN_PATH = `/signin?returnTo=${RETURN_TO}`;
const running: GoogleSignInFlow = { running: true, error: null };

const failed = (failure: AuthFailure): CallResult => ({
  kind: "failed",
  failure,
});

function setup({ search = "", offline = false } = {}) {
  const authenticator = createFakeGoogleSignInAuthenticator();
  const address = createFakePageAddress(search);
  const pageReplace = { replace: vi.fn<(path: string) => void>() };
  const connectivity = createFakeConnectivity(offline);
  const googleSignIn = createGoogleSignIn({
    authenticator,
    address,
    pageReplace,
    connectivity,
  });
  return {
    googleSignIn,
    authenticator,
    address,
    pageReplace,
    ...screenHarness<GoogleSignInFlow, GoogleSignInEvent>(googleSignInReducer),
  };
}

describe("Googleでのサインインの手続き", () => {
  describe("開始", () => {
    it("オンラインなら、遷移元を載せた戻り先でGoogleの認証を始め、実行中にする", async () => {
      // Given
      const { googleSignIn, authenticator, viewOf } = setup();
      const view = viewOf(initialGoogleSignInFlow);

      // When
      await googleSignIn.start({ returnPath: RETURN_PATH }, view);

      // Then
      expect(authenticator.startGoogleSignIn).toHaveBeenCalledExactlyOnceWith({
        returnPath: RETURN_PATH,
      });
      expect(view.observedState).toEqual({ running: true, error: null });
    });

    it("オフラインなら、理由を示して始めない", async () => {
      // Given
      const { googleSignIn, authenticator, viewOf } = setup({ offline: true });
      const view = viewOf(initialGoogleSignInFlow);

      // When
      await googleSignIn.start({ returnPath: RETURN_PATH }, view);

      // Then
      expect(authenticator.startGoogleSignIn).not.toHaveBeenCalled();
      expect(view.observedState).toEqual({ running: false, error: "offline" });
    });

    it("実行中の再押下は、認証を呼ばず、何も変えない", async () => {
      // Given
      const { googleSignIn, authenticator, events, viewOf } = setup();
      const view = viewOf(running);

      // When
      await googleSignIn.start({ returnPath: RETURN_PATH }, view);

      // Then
      expect(authenticator.startGoogleSignIn).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(view.observedState).toEqual(running);
    });

    it("開始が失敗したら、種類によらずGoogleでの認証の失敗を示して実行中を解く", async () => {
      // Given
      const { googleSignIn, authenticator, viewOf } = setup();
      authenticator.startGoogleSignIn.mockResolvedValue(
        failed({ kind: "other" }),
      );
      const view = viewOf(initialGoogleSignInFlow);

      // When
      await googleSignIn.start({ returnPath: RETURN_PATH }, view);

      // Then
      expect(view.observedState).toEqual({
        running: false,
        error: "google_auth_failed",
      });
    });
  });

  describe("戻りの読み取り", () => {
    it("戻りの無い読み込みでは、URLの書き換えも交換もせず、表示を変えない", async () => {
      // Given
      const {
        googleSignIn,
        authenticator,
        address,
        pageReplace,
        events,
        viewOf,
      } = setup({ search: `?returnTo=${RETURN_TO}` });
      const view = viewOf(initialGoogleSignInFlow);

      // When
      await googleSignIn.resume({ destination: null }, view);

      // Then
      expect(address.rewrite).not.toHaveBeenCalled();
      expect(authenticator.exchangeGoogleCode).not.toHaveBeenCalled();
      expect(pageReplace.replace).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(view.observedState).toEqual(initialGoogleSignInFlow);
    });

    it("取り消しの戻りは、遷移元を残してURLから戻りを外すだけで、何も示さず再操作できる", async () => {
      // Given
      const { googleSignIn, authenticator, address, viewOf } = setup({
        search: `?returnTo=${RETURN_TO}&error=access_denied&error_description=denied`,
      });
      const view = viewOf(initialGoogleSignInFlow);

      // When
      await googleSignIn.resume({ destination: null }, view);

      // Then
      expect(address.rewrite).toHaveBeenCalledExactlyOnceWith(
        `?returnTo=${RETURN_TO}`,
      );
      expect(authenticator.exchangeGoogleCode).not.toHaveBeenCalled();
      expect(view.observedState).toEqual(initialGoogleSignInFlow);
    });

    it("その他の失敗の戻りは、URLから戻りを外し、Googleでの認証の失敗を示して、交換しない", async () => {
      // Given
      const { googleSignIn, authenticator, address, viewOf } = setup({
        search: "?error=server_error&error_description=x",
      });
      const view = viewOf(initialGoogleSignInFlow);

      // When
      await googleSignIn.resume({ destination: null }, view);

      // Then
      expect(address.rewrite).toHaveBeenCalledExactlyOnceWith("");
      expect(authenticator.exchangeGoogleCode).not.toHaveBeenCalled();
      expect(view.observedState).toEqual({
        running: false,
        error: "google_auth_failed",
      });
    });
  });

  describe("別のアカウントで使用中の戻り(追加の戻りの形)", () => {
    it("サインインでは、Googleでの認証の失敗を示し、URLから戻りを外して、交換しない", async () => {
      // Given
      const { googleSignIn, authenticator, address, viewOf } = setup({
        search: "?error=server_error&error_code=identity_already_exists",
      });
      const view = viewOf(initialGoogleSignInFlow);

      // When
      await googleSignIn.resume({ destination: null }, view);

      // Then
      expect(address.rewrite).toHaveBeenCalledExactlyOnceWith("");
      expect(authenticator.exchangeGoogleCode).not.toHaveBeenCalled();
      expect(view.observedState).toEqual({
        running: false,
        error: "google_auth_failed",
      });
    });
  });

  describe("codeの戻り", () => {
    it("先に戻りを外し、交換して成功なら遷移元(ハッシュ付き)へページ全体を置き換え、実行中を解かない", async () => {
      // Given
      const { googleSignIn, authenticator, address, pageReplace, viewOf } =
        setup({ search: "?code=x" });
      const order: string[] = [];
      address.rewrite = vi.fn(() => {
        order.push("rewrite");
      });
      authenticator.exchangeGoogleCode.mockImplementation(async () => {
        order.push("exchange");
        return { kind: "accepted" };
      });
      const view = viewOf(initialGoogleSignInFlow);

      // When
      await googleSignIn.resume(
        { destination: "/rounds/history#settings/account" },
        view,
      );

      // Then
      expect(order).toEqual(["rewrite", "exchange"]);
      expect(authenticator.exchangeGoogleCode).toHaveBeenCalledExactlyOnceWith(
        "x",
      );
      expect(pageReplace.replace).toHaveBeenCalledExactlyOnceWith(
        "/rounds/history#settings/account",
      );
      expect(view.observedState.running).toBe(true);
    });

    it.each<[string, string | null]>([
      ["遷移元が無い", null],
      ["遷移元が外部のURLである", "https://example.com/"],
      ["遷移元がオリジンを迂回する形である", "//evil.example"],
      ["遷移元が経路の外である", "/signin"],
    ])("%sなら、ホームへ置き換える", async (_name, destination) => {
      // Given
      const { googleSignIn, pageReplace, viewOf } = setup({
        search: "?code=x",
      });

      // When
      await googleSignIn.resume(
        { destination },
        viewOf(initialGoogleSignInFlow),
      );

      // Then
      expect(pageReplace.replace).toHaveBeenCalledExactlyOnceWith("/rounds");
    });

    it.each<[string, AuthFailure]>([
      ["届かない", UNREACHABLE],
      ["制限", { kind: "rate_limited" }],
      ["その他", { kind: "other" }],
    ])(
      "交換が%sで失敗したら、種類によらずGoogleでの認証の失敗を示し、実行中を解いて、置き換えない",
      async (_name, failure) => {
        // Given
        const { googleSignIn, authenticator, pageReplace, viewOf } = setup({
          search: "?code=x",
        });
        authenticator.exchangeGoogleCode.mockResolvedValue(failed(failure));
        const view = viewOf(initialGoogleSignInFlow);

        // When
        await googleSignIn.resume({ destination: null }, view);

        // Then
        expect(pageReplace.replace).not.toHaveBeenCalled();
        expect(view.observedState).toEqual({
          running: false,
          error: "google_auth_failed",
        });
      },
    );

    it("交換の途中で画面を離れたら、失敗を返されても、表示を変えず、置き換えない", async () => {
      // Given
      const {
        googleSignIn,
        authenticator,
        pageReplace,
        screen,
        events,
        viewOf,
      } = setup({ search: "?code=x" });
      const response = Promise.withResolvers<CallResult>();
      authenticator.exchangeGoogleCode.mockReturnValue(response.promise);
      const running = googleSignIn.resume(
        { destination: null },
        viewOf(initialGoogleSignInFlow),
      );
      screen.mounted = false;

      // When
      response.resolve(failed(UNREACHABLE));
      await running;

      // Then
      expect(events).toEqual([]);
      expect(pageReplace.replace).not.toHaveBeenCalled();
    });
  });
});

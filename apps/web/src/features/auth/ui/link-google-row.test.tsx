import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import { LINK_GOOGLE_PARAM, LINK_GOOGLE_VALUE } from "@/routes";
import { createFakeAccountSummaryStore } from "../application/account-summary-store-test-helpers";
import type { CallResult } from "../application/call-result";
import { createLinkGoogle } from "../application/link-google";
import {
  createFakeEmailIdentityPreparation,
  createFakeLinkGoogleAuthenticator,
  readingOf,
} from "../application/link-google-test-helpers";
import type { AccountSummary } from "../domain/account-summary";
import { LinkGoogleProvider } from "./link-google-context";
import { LinkGoogleRow } from "./link-google-row";

const authText = translatorFor("auth");
const sharedText = translatorFor("shared");

const WITHOUT_GOOGLE: AccountSummary = {
  userId: "user-1",
  email: "user@example.com",
  google: null,
};
const WITH_GOOGLE: AccountSummary = {
  userId: "user-1",
  email: "user@example.com",
  google: { id: "identity-1", email: "archer@gmail.example" },
};

const pending = () => new Promise<never>(() => {});

function setup(
  options: {
    stored?: AccountSummary | null;
    read?: AccountSummary;
    offline?: boolean;
  } = {},
) {
  const stored = options.stored === undefined ? WITHOUT_GOOGLE : options.stored;
  const authenticator = createFakeLinkGoogleAuthenticator(
    readingOf(options.read ?? stored ?? WITHOUT_GOOGLE),
  );
  const emailIdentity = createFakeEmailIdentityPreparation();
  const summaries = createFakeAccountSummaryStore(stored);
  const linkGoogle = createLinkGoogle({
    authenticator,
    emailIdentity,
    summaries,
    connectivity: createFakeConnectivity(options.offline ?? false),
  });
  const onBusyChange = vi.fn();
  const mount = () =>
    render(
      <LinkGoogleProvider linkGoogle={linkGoogle}>
        <LinkGoogleRow onBusyChange={onBusyChange} />
      </LinkGoogleProvider>,
      { wrapper: IntlTestProvider },
    );
  return { authenticator, emailIdentity, linkGoogle, onBusyChange, mount };
}

function addButton() {
  return screen.getByRole("button", { name: authText("linkGoogleAdd") });
}

function removeButton() {
  return screen.getByRole("button", { name: authText("linkGoogleRemove") });
}

describe("LinkGoogleRow", () => {
  describe("表示", () => {
    it("Googleが結び付いていないとき、「追加」を示し、アドレスを示さない", async () => {
      // Given
      const h = setup({ stored: WITHOUT_GOOGLE });

      // When
      h.mount();

      // Then
      expect(addButton()).toBeVisible();
      expect(
        screen.queryByRole("button", { name: authText("linkGoogleRemove") }),
      ).toBeNull();
      await waitFor(() =>
        expect(h.authenticator.readAccount).toHaveBeenCalled(),
      );
    });

    it("Googleが結び付いているとき、Googleのアドレスと「削除」を示す", async () => {
      // Given
      const h = setup({ stored: WITH_GOOGLE });

      // When
      h.mount();

      // Then
      expect(screen.getByText("archer@gmail.example")).toBeVisible();
      expect(removeButton()).toBeVisible();
      expect(
        screen.queryByRole("button", { name: authText("linkGoogleAdd") }),
      ).toBeNull();
      await waitFor(() =>
        expect(h.authenticator.readAccount).toHaveBeenCalled(),
      );
    });

    it("記録が無く読み直す前は、読み込み中を示し、「追加」も「削除」も押せない", () => {
      // Given
      const h = setup({ stored: null });
      h.authenticator.readAccount.mockReturnValue(pending());

      // When
      h.mount();

      // Then
      expect(screen.getByText(authText("linkGoogleLoading"))).toBeVisible();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("記録が無く読み直せないときも、読み込み中のまま「追加」も「削除」も押せない", async () => {
      // Given
      const h = setup({ stored: null });
      h.authenticator.readAccount.mockResolvedValue({
        kind: "failed",
        failure: { kind: "unreachable" },
      });

      // When
      h.mount();

      // Then
      await waitFor(() =>
        expect(h.authenticator.readAccount).toHaveBeenCalled(),
      );
      expect(screen.getByText(authText("linkGoogleLoading"))).toBeVisible();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("記録が無く読み直せたとき、読み直した内容を示す", async () => {
      // Given
      const h = setup({ stored: null, read: WITH_GOOGLE });

      // When
      h.mount();

      // Then
      expect(await screen.findByText("archer@gmail.example")).toBeVisible();
      expect(removeButton()).toBeVisible();
    });
  });

  describe("追加", () => {
    it("「追加」を押すと追加が始まり、処理中として示し、再押下は何もしない", async () => {
      // Given
      const h = setup();
      h.authenticator.startGoogleLink.mockReturnValue(pending());
      h.mount();
      const user = userEvent.setup();

      // When
      await user.click(addButton());
      await user.click(addButton());

      // Then
      expect(h.authenticator.startGoogleLink).toHaveBeenCalledOnce();
      expect(addButton()).toHaveAttribute("aria-disabled", "true");
      expect(h.onBusyChange).toHaveBeenLastCalledWith(true);
    });

    it("オフラインで「追加」を押すと、Googleへ移らず、オフラインを示す", async () => {
      // Given
      const h = setup({ offline: true });
      h.mount();
      const user = userEvent.setup();

      // When
      await user.click(addButton());

      // Then
      expect(h.authenticator.startGoogleLink).not.toHaveBeenCalled();
      expect(screen.getByText(authText("failure.offline"))).toBeVisible();
    });

    it("移動中にbfcacheで復元されると、処理中を解く", async () => {
      // Given
      const h = setup();
      h.authenticator.startGoogleLink.mockReturnValue(pending());
      h.mount();
      const user = userEvent.setup();
      await user.click(addButton());

      // When
      act(() => {
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        );
      });

      // Then
      expect(addButton()).toHaveAttribute("aria-disabled", "false");
      expect(h.onBusyChange).toHaveBeenLastCalledWith(false);
    });
  });

  describe("削除", () => {
    it("「削除」を押すと確認を示し、キャンセルすると手続きを呼ばず元の行へ戻る", async () => {
      // Given
      const h = setup({ stored: WITH_GOOGLE });
      h.mount();
      const user = userEvent.setup();

      // When
      await user.click(removeButton());
      const dialog = await screen.findByRole("dialog");
      expect(
        within(dialog).getByText(authText("linkGoogleConfirm")),
      ).toBeVisible();
      await user.click(
        within(dialog).getByRole("button", {
          name: sharedText("confirmCancel"),
        }),
      );

      // Then
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(h.authenticator.unlinkGoogle).not.toHaveBeenCalled();
      expect(screen.getByText("archer@gmail.example")).toBeVisible();
    });

    it("確認で確定すると、メールの手段を確かめてからGoogleの手段を解除し、削除した旨を示す", async () => {
      // Given
      const h = setup({ stored: WITH_GOOGLE });
      // マウント時の読み直しは結び付きのまま、削除後の読み直しは結び付きなしを返す。
      h.authenticator.readAccount
        .mockResolvedValueOnce(readingOf(WITH_GOOGLE))
        .mockResolvedValue(readingOf(WITHOUT_GOOGLE));
      h.mount();
      const user = userEvent.setup();
      await user.click(removeButton());
      const dialog = await screen.findByRole("dialog");

      // When
      await user.click(within(dialog).getByTestId("confirm-dialog-confirm"));

      // Then
      expect(
        await screen.findByText(authText("linkGoogleRemoved")),
      ).toBeVisible();
      expect(h.emailIdentity.ensure).toHaveBeenCalledOnce();
      expect(h.authenticator.unlinkGoogle).toHaveBeenCalledExactlyOnceWith(
        "identity-1",
      );
      expect(addButton()).toBeVisible();
    });

    it("解除が届かなかったとき、通信エラーを示し、読み直した行を示す", async () => {
      // Given
      const h = setup({ stored: WITH_GOOGLE });
      h.authenticator.unlinkGoogle.mockResolvedValue({
        kind: "failed",
        failure: { kind: "unreachable" },
      } satisfies CallResult);
      h.mount();
      const user = userEvent.setup();
      await user.click(removeButton());
      const dialog = await screen.findByRole("dialog");

      // When
      await user.click(within(dialog).getByTestId("confirm-dialog-confirm"));

      // Then
      expect(
        await screen.findByText(authText("failure.unreachable")),
      ).toBeVisible();
      expect(screen.getByText("archer@gmail.example")).toBeVisible();
    });
  });

  describe("マウント時", () => {
    it("オンラインでは読み直し、読み直した内容を示す", async () => {
      // Given
      const h = setup({ stored: WITHOUT_GOOGLE, read: WITH_GOOGLE });

      // When
      h.mount();

      // Then
      expect(await screen.findByText("archer@gmail.example")).toBeVisible();
      expect(h.authenticator.readAccount).toHaveBeenCalledOnce();
    });

    it("オフラインでは読み直さない", () => {
      // Given
      const h = setup({ offline: true });

      // When
      h.mount();

      // Then
      expect(h.authenticator.readAccount).not.toHaveBeenCalled();
    });

    it("預かった追加の戻りが成功なら、読み直して追加した旨を示す", async () => {
      // Given
      const h = setup({ stored: WITHOUT_GOOGLE, read: WITH_GOOGLE });
      h.linkGoogle.capture(`?${LINK_GOOGLE_PARAM}=${LINK_GOOGLE_VALUE}&code=c`);

      // When
      h.mount();

      // Then
      expect(
        await screen.findByText(authText("linkGoogleAdded")),
      ).toBeVisible();
      expect(screen.getByText("archer@gmail.example")).toBeVisible();
    });

    it.each([
      [
        "取り消し",
        "error=access_denied&error_description=cancelled",
        "failure.google_link_cancelled",
      ],
      [
        "別のアカウントで使用中",
        "error=server_error&error_code=identity_already_exists",
        "failure.google_link_taken",
      ],
      ["その他の失敗", "error=server_error", "failure.other"],
    ] as const)(
      "預かった追加の戻りが%sなら、その理由を示し、行は元のままである",
      async (_name, query, textKey) => {
        // Given
        const h = setup({ stored: WITHOUT_GOOGLE });
        h.linkGoogle.capture(
          `?${LINK_GOOGLE_PARAM}=${LINK_GOOGLE_VALUE}&${query}`,
        );

        // When
        h.mount();

        // Then
        expect(await screen.findByText(authText(textKey))).toBeVisible();
        expect(addButton()).toBeVisible();
      },
    );
  });
});

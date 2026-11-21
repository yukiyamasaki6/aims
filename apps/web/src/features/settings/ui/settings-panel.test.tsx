import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { SettingsView } from "../domain/settings-location";
import { type SettingsItemControls, SettingsPanel } from "./settings-panel";

const settingsText = translatorFor("settings");

type User = ReturnType<typeof userEvent.setup>;

// 項目の画面の代役。入力欄と、パネルへ渡された操作を押す3つのボタンを持つ。
function ItemProbe({
  view,
  controls,
}: {
  view: string;
  controls: SettingsItemControls;
}) {
  return (
    <div>
      <p>項目の画面:{view}</p>
      <input aria-label="入力" />
      <button type="button" onClick={() => controls.onBusyChange(true)}>
        処理を始める
      </button>
      <button type="button" onClick={() => controls.onBusyChange(false)}>
        処理を終える
      </button>
      <button type="button" onClick={controls.onBack}>
        項目の戻る
      </button>
    </div>
  );
}

const renderItem: ComponentProps<typeof SettingsPanel>["renderItem"] = (
  view,
  controls,
) => <ItemProbe view={view} controls={controls} />;

const EMAIL = "user@example.com";

// 「Google認証」の行の代役。パネルから渡された処理中の知らせを押す2つのボタンを持つ。
const renderGoogle: ComponentProps<typeof SettingsPanel>["renderGoogle"] = ({
  onBusyChange,
}) => (
  <div>
    <button type="button" onClick={() => onBusyChange(true)}>
      Googleの処理を始める
    </button>
    <button type="button" onClick={() => onBusyChange(false)}>
      Googleの処理を終える
    </button>
  </div>
);

function setup(props: Partial<ComponentProps<typeof SettingsPanel>> = {}) {
  const onMove = vi.fn();
  const onClose = vi.fn();
  const rendered = render(
    <SettingsPanel
      view="account"
      onMove={onMove}
      onClose={onClose}
      email={EMAIL}
      renderGoogle={renderGoogle}
      signOut={<button type="button">サインアウトの行</button>}
      renderItem={renderItem}
      {...props}
    />,
    { wrapper: IntlTestProvider },
  );
  return { onMove, onClose, ...rendered };
}

function panel() {
  return screen.getByRole("dialog", { name: settingsText("title") });
}

function closeButton() {
  return screen.getByRole("button", { name: settingsText("close") });
}

function categoryLink() {
  return screen.getByRole("link", {
    name: settingsText("accountTitle"),
  });
}

// base-uiのBackdrop。ダイアログの外側の押下の先。
function backdrop() {
  const backdrops = document.querySelectorAll(
    '[role="presentation"][data-open]',
  );
  return backdrops[backdrops.length - 1];
}

const ALL_VIEWS: SettingsView[] = ["account", "email", "delete-account"];

describe("SettingsPanel", () => {
  describe("表示", () => {
    it("分類アイコンは装飾として隠され、分類の名前は文字だけになる", () => {
      // Given
      // When
      setup();

      // Then
      const category = categoryLink();
      expect(category).toHaveAccessibleName(settingsText("accountTitle"));
      expect(category.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });

    it("閉じているとき、何も描かない", () => {
      // Given
      // When
      setup({ view: null });

      // Then
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it.each(ALL_VIEWS)(
      "%sの表示で開くと、名前「設定」の対話の領域に、閉じる操作と分類の一覧(「アカウント」だけ)を表示する",
      (view) => {
        // Given
        // When
        setup({ view });

        // Then
        expect(
          within(panel()).getByRole("button", { name: settingsText("close") }),
        ).toBeInTheDocument();
        const links = within(panel())
          .getAllByRole("link")
          .filter((link) => link.closest("nav"));
        expect(links).toHaveLength(1);
        expect(links[0]).toHaveTextContent(settingsText("accountTitle"));
      },
    );

    it.each(ALL_VIEWS)(
      "%sの表示でも、分類「アカウント」が現在の分類としてaria-current=pageを持つ",
      (view) => {
        // Given
        // When
        setup({ view });

        // Then
        expect(categoryLink()).toHaveAttribute("aria-current", "page");
      },
    );

    it("分類の表示では、項目の画面でなく分類の本文(サインアウトの行)を描く", () => {
      // Given
      // When
      setup({ view: "account" });

      // Then
      expect(screen.getByText("サインアウトの行")).toBeInTheDocument();
      expect(screen.queryByText(/項目の画面:/)).toBeNull();
    });

    it("項目の表示では、描画の関数に表示を渡して項目の画面を描き、分類の本文は描かない", () => {
      // Given
      // When
      setup({ view: "delete-account" });

      // Then
      expect(screen.getByText("項目の画面:delete-account")).toBeInTheDocument();
      expect(screen.queryByText("サインアウトの行")).toBeNull();
    });

    it("表示が変わると、項目の画面を作り直し、入力を持ち越さない", async () => {
      // Given
      const user = userEvent.setup();
      const { rerender, onMove, onClose } = setup({ view: "email" });
      await user.type(screen.getByLabelText("入力"), "入力済み");

      // When
      rerender(
        <SettingsPanel
          view="delete-account"
          onMove={onMove}
          onClose={onClose}
          email={EMAIL}
          renderGoogle={renderGoogle}
          signOut={null}
          renderItem={renderItem}
        />,
      );

      // Then
      expect(screen.getByText("項目の画面:delete-account")).toBeInTheDocument();
      expect(screen.getByLabelText("入力")).toHaveValue("");
    });
  });

  describe("操作", () => {
    it("分類を選ぶと、分類の表示で移る操作を呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      const { onMove } = setup({ view: "email" });

      // When
      await user.click(categoryLink());

      // Then
      expect(onMove).toHaveBeenCalledExactlyOnceWith("account");
    });

    it("項目の画面から渡された戻る操作は、分類の表示で移る操作を呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      const { onMove } = setup({ view: "email" });

      // When
      await user.click(screen.getByRole("button", { name: "項目の戻る" }));

      // Then
      expect(onMove).toHaveBeenCalledExactlyOnceWith("account");
    });

    it("閉じる操作で、閉じる操作を呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      const { onClose } = setup();

      // When
      await user.click(closeButton());

      // Then
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("Escで、閉じる操作を呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      const { onClose } = setup();

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(onClose).toHaveBeenCalledOnce();
    });

    // 外側の押下は幅768px以上の挙動で、jsdomは配置を持たないため、背景の要素の押下で確かめる。
    it("外側(背景)の押下で、閉じる操作を呼ぶ", async () => {
      // Given
      const user = userEvent.setup();
      const { onClose } = setup();

      // When
      await user.click(backdrop());

      // Then
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("閉じても、開く前にフォーカスがあった要素へフォーカスを戻さない", async () => {
      // Given
      const opener = document.createElement("button");
      document.body.append(opener);
      opener.focus();
      const { rerender, onMove, onClose } = setup();
      await waitFor(() => expect(closeButton()).toHaveFocus());

      // When
      rerender(
        <SettingsPanel
          view={null}
          onMove={onMove}
          onClose={onClose}
          email={EMAIL}
          renderGoogle={renderGoogle}
          signOut={null}
          renderItem={renderItem}
        />,
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      // Then
      expect(opener).not.toHaveFocus();
      opener.remove();
    });
  });

  describe("処理中", () => {
    async function startBusy(view: SettingsView = "delete-account") {
      const user = userEvent.setup();
      const handlers = setup({ view });
      await user.click(screen.getByRole("button", { name: "処理を始める" }));
      return { user, ...handlers };
    }

    it.each([
      ["閉じる操作", async (user: User) => user.click(closeButton())],
      ["Esc", async (user: User) => user.keyboard("{Escape}")],
      ["外側の押下", async (user: User) => user.click(backdrop())],
      ["分類の選択", async (user: User) => user.click(categoryLink())],
      [
        "分類のEnter操作",
        async (user: User) => {
          categoryLink().focus();
          await user.keyboard("{Enter}");
        },
      ],
    ])(
      "項目が処理中を知らせている間は、%sで呼び先を呼ばず、表示も変えない",
      async (_name, operate) => {
        // Given
        const { user, onClose, onMove } = await startBusy();

        // When
        await operate(user);

        // Then
        expect(onClose).not.toHaveBeenCalled();
        expect(onMove).not.toHaveBeenCalled();
        expect(
          screen.getByText("項目の画面:delete-account"),
        ).toBeInTheDocument();
        expect(categoryLink()).toHaveAttribute("aria-disabled", "true");
        expect(categoryLink()).toHaveAttribute("aria-current", "page");
        expect(categoryLink()).toHaveAccessibleName(
          settingsText("accountTitle"),
        );
      },
    );

    it.each([
      ["閉じる操作", async (user: User) => user.click(closeButton())],
      ["Esc", async (user: User) => user.keyboard("{Escape}")],
      ["外側の押下", async (user: User) => user.click(backdrop())],
      ["分類の選択", async (user: User) => user.click(categoryLink())],
    ])(
      "Googleの行が処理中を知らせている間は、%sで呼び先を呼ばない",
      async (_name, operate) => {
        // Given
        const user = userEvent.setup();
        const { onClose, onMove } = setup({ view: "account" });
        await user.click(
          screen.getByRole("button", { name: "Googleの処理を始める" }),
        );

        // When
        await operate(user);

        // Then
        expect(onClose).not.toHaveBeenCalled();
        expect(onMove).not.toHaveBeenCalled();
      },
    );

    it("Googleの行の処理中が解けると、閉じる操作と分類の選択を再び受け付ける", async () => {
      // Given
      const user = userEvent.setup();
      const { onClose, onMove } = setup({ view: "account" });
      await user.click(
        screen.getByRole("button", { name: "Googleの処理を始める" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Googleの処理を終える" }),
      );

      // When
      await user.click(categoryLink());
      await user.click(closeButton());

      // Then
      expect(onMove).toHaveBeenCalledExactlyOnceWith("account");
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("項目が処理中を知らせている間は、項目から渡された戻る操作も、移る操作を呼ばない", async () => {
      // Given
      const { user, onMove } = await startBusy();

      // When
      await user.click(screen.getByRole("button", { name: "項目の戻る" }));

      // Then
      expect(onMove).not.toHaveBeenCalled();
    });

    it("処理中が解けると、分類の選択を再び受け付ける", async () => {
      // Given
      const { user, onMove } = await startBusy();
      await user.click(screen.getByRole("button", { name: "処理を終える" }));

      // When
      await user.click(categoryLink());

      // Then
      expect(categoryLink()).not.toHaveAttribute("aria-disabled", "true");
      expect(onMove).toHaveBeenCalledExactlyOnceWith("account");
    });

    it("処理中が解けると、閉じる操作を再び受け付ける", async () => {
      // Given
      const { user, onClose } = await startBusy();
      await user.click(screen.getByRole("button", { name: "処理を終える" }));

      // When
      await user.click(closeButton());

      // Then
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("処理中のまま表示が変わると、処理中が解け、次の表示で閉じる操作を受け付ける", async () => {
      // Given
      const { user, rerender, onMove, onClose } = await startBusy();
      rerender(
        <SettingsPanel
          view="account"
          onMove={onMove}
          onClose={onClose}
          email={EMAIL}
          renderGoogle={renderGoogle}
          signOut={null}
          renderItem={renderItem}
        />,
      );

      // When
      await user.click(closeButton());

      // Then
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("入れ子のダイアログ", () => {
    function NestedRow() {
      const [open, setOpen] = useState(true);
      return (
        <BlockingConfirmDialog
          open={open}
          onOpenChange={setOpen}
          description="確認の説明"
          onConfirm={vi.fn()}
          busy={false}
          error={null}
          nested
        />
      );
    }

    it("確認のダイアログが開いているとき、Escで確認のダイアログだけが閉じ、パネルの閉じる操作は呼ばれない", async () => {
      // Given
      const user = userEvent.setup();
      const { onClose } = setup({ signOut: <NestedRow /> });

      // When
      await user.keyboard("{Escape}");

      // Then
      expect(screen.queryByText("確認の説明")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(panel()).toBeInTheDocument();
    });

    it("確認のダイアログが開いているとき、外側の押下で確認のダイアログだけが閉じ、パネルの閉じる操作は呼ばれない", async () => {
      // Given
      const user = userEvent.setup();
      const { onClose } = setup({ signOut: <NestedRow /> });

      // When
      await user.click(backdrop());

      // Then
      expect(screen.queryByText("確認の説明")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("キーボード", () => {
    // パネルの外へ出ないことは、jsdomがフォーカスの囲い込みを再現しないため、E2Eが確かめる。
    it("Tabで閉じる操作、分類、本文の順にフォーカスが届く", async () => {
      // Given
      const user = userEvent.setup();
      setup({ view: "delete-account" });
      // 開いた直後のフォーカスは、パネルの先頭の閉じる操作にある(初期フォーカスは描画の後に移る)。
      await waitFor(() => expect(closeButton()).toHaveFocus());

      // When
      const reached: (Element | null)[] = [];
      for (let i = 0; i < 2; i++) {
        await user.tab();
        reached.push(document.activeElement);
      }

      // Then
      expect(reached).toEqual([categoryLink(), screen.getByLabelText("入力")]);
    });

    it("項目画面で分類へTabで到達してEnterを押すと、一覧へ移る操作を通知する", async () => {
      // Given
      const user = userEvent.setup();
      const { onMove } = setup({ view: "email" });
      await waitFor(() => expect(closeButton()).toHaveFocus());

      // When
      await user.tab();
      await user.keyboard("{Enter}");

      // Then
      expect(categoryLink()).toHaveFocus();
      expect(onMove).toHaveBeenCalledWith("account");
    });
  });
});

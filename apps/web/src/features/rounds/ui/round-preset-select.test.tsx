import {
  act,
  render as renderWithoutStore,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { FetchResult } from "../domain/fetch-status";
import type { Preset, Presets } from "../domain/preset";
import { RoundPresetSelect } from "./round-preset-select";
import { createFakeNewRoundStore } from "./round-stores-test-helpers";
import { NewRoundStoreProvider } from "./rounds-context";

const roundsText = translatorFor("rounds");

// 取得、削除、開始の手続きは、それぞれのテストで確かめるため、ラウンドの状態と変更の方法は偽の約束で渡す。
// offlineの結果が返る状況は通信が切れている(切れていないと、すぐ再取得する)。
let fake: ReturnType<typeof createFakeNewRoundStore>;
let loadPresets: ReturnType<
  typeof createFakeNewRoundStore
>["store"]["loadPresets"];
let startRound: ReturnType<
  typeof createFakeNewRoundStore
>["store"]["startRound"];
let deletePreset: ReturnType<
  typeof createFakeNewRoundStore
>["store"]["deletePreset"];

function render(ui: ReactElement) {
  return renderWithoutStore(
    <IntlTestProvider>
      <NewRoundStoreProvider store={fake.store}>{ui}</NewRoundStoreProvider>
    </IntlTestProvider>,
  );
}

function fetchResolves(result: FetchResult<Presets>) {
  loadPresets.mockResolvedValue(result);
}

// 取得結果の一覧が出るまで待ってから返す。
async function renderSelect(personal: Preset[], global: Preset[]) {
  fetchResolves({ status: "ok", data: { personal, global } });
  const view = render(<RoundPresetSelect />);
  await waitFor(() => {
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  return view;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// 保留中の非同期処理を進めるため、マクロタスク1回分待つ。
function flushMacrotask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const personalPreset: Preset = {
  id: "preset-personal",
  name: "個人練習セット",
  format: "outdoor",
  bow_type: "recurve",
  preset_distances: [
    {
      id: "d2",
      position_key: "1-2",
      distance: 50,
      is_marked: true,
      total_ends: 6,
      arrows_per_end: 6,
      target_face_id: "face-1",
      target_faces: null,
    },
    {
      id: "d1",
      position_key: "1-1",
      distance: 70,
      is_marked: true,
      total_ends: 6,
      arrows_per_end: 6,
      target_face_id: "face-1",
      target_faces: null,
    },
  ],
};

const globalPreset: Preset = {
  id: "preset-global",
  name: "公式720ラウンド",
  format: "outdoor",
  bow_type: "recurve",
  preset_distances: [],
};

const otherPersonalPreset: Preset = {
  id: "preset-personal-2",
  name: "別の個人セット",
  format: "indoor",
  bow_type: "compound",
  preset_distances: [],
};

beforeEach(() => {
  fake = createFakeNewRoundStore();
  fake.goOffline();
  loadPresets = fake.store.loadPresets;
  startRound = fake.store.startRound;
  deletePreset = fake.store.deletePreset;
  startRound.mockResolvedValue({ status: "created", roundId: "new-round-id" });
  deletePreset.mockResolvedValue({ status: "deleted" });
});

describe("RoundPresetSelect", () => {
  describe("取得の状態", () => {
    it("取得中は読み込み中の表示と、枠と、押せる開始ボタンを表示し、プリセットの見出しは出さない", () => {
      // Given
      loadPresets.mockReturnValue(new Promise(() => {}));

      // When
      render(<RoundPresetSelect />);

      // Then
      expect(screen.getByRole("status")).toHaveTextContent(
        roundsText("fetchLoading"),
      );
      expect(
        screen.getByRole("link", { name: roundsText("backToList") }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: roundsText("startWithoutPreset") }),
      ).toHaveAttribute("aria-disabled", "false");
      expect(
        screen.queryByText(roundsText("presetPersonal")),
      ).not.toBeInTheDocument();
    });

    it("取得が完了しない間も開始ボタンは押せ、押すとプリセット未選択で開始を依頼する", async () => {
      // Given
      loadPresets.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      render(<RoundPresetSelect />);

      // When
      await user.click(
        screen.getByRole("button", { name: roundsText("startWithoutPreset") }),
      );

      // Then
      await waitFor(() => {
        expect(startRound).toHaveBeenCalledTimes(1);
      });
      expect(startRound).toHaveBeenCalledWith(null, expect.any(Function));
    });

    it("通信できない場合はネットワークに接続されていませんを表示し、プリセットの見出しは出さない", async () => {
      // Given
      fetchResolves({ status: "offline" });

      // When
      render(<RoundPresetSelect />);

      // Then
      expect(
        await screen.findByText(roundsText("fetchOffline")),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(roundsText("presetPersonal")),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(roundsText("presetGlobal")),
      ).not.toBeInTheDocument();
    });

    it("通信できない場合も、開始ボタンを押すとラウンドの開始を依頼する", async () => {
      // Given
      fetchResolves({ status: "offline" });
      const user = userEvent.setup();
      render(<RoundPresetSelect />);
      await screen.findByText(roundsText("fetchOffline"));

      // When
      await user.click(
        screen.getByRole("button", { name: roundsText("startWithoutPreset") }),
      );

      // Then
      await waitFor(() => {
        expect(startRound).toHaveBeenCalledTimes(1);
      });
    });

    it("取得がエラーの場合はエラーメッセージを表示する", async () => {
      // Given
      fetchResolves({ status: "error", reason: "failed" });

      // When
      render(<RoundPresetSelect />);

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        roundsText("fetchFailure.failed"),
      );
    });

    it("取得がエラーの場合も、開始ボタンを押すとラウンドの開始を依頼する", async () => {
      // Given
      fetchResolves({ status: "error", reason: "failed" });
      const user = userEvent.setup();
      render(<RoundPresetSelect />);
      await screen.findByRole("alert");

      // When
      await user.click(
        screen.getByRole("button", { name: roundsText("startWithoutPreset") }),
      );

      // Then
      await waitFor(() => {
        expect(startRound).toHaveBeenCalledTimes(1);
      });
    });

    it("再試行すると取得し直し、取得できたプリセットを表示する", async () => {
      // Given
      loadPresets
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({
          status: "ok",
          data: { personal: [], global: [globalPreset] },
        });
      const user = userEvent.setup();
      render(<RoundPresetSelect />);

      // When
      await user.click(
        await screen.findByRole("button", { name: roundsText("fetchRetry") }),
      );

      // Then
      expect(await screen.findByText("公式720ラウンド")).toBeInTheDocument();
      expect(
        screen.queryByText(roundsText("fetchOffline")),
      ).not.toBeInTheDocument();
      expect(loadPresets).toHaveBeenCalledTimes(2);
    });
  });

  describe("取得の接続", () => {
    it("表示の開始時にストアのloadPresetsを1回呼び、その結果を表示する", async () => {
      // Given
      fetchResolves({
        status: "ok",
        data: { personal: [], global: [globalPreset] },
      });

      // When
      render(<RoundPresetSelect />);

      // Then
      expect(await screen.findByText("公式720ラウンド")).toBeInTheDocument();
      expect(loadPresets).toHaveBeenCalledTimes(1);
    });

    it("通信できない結果の後に通信が戻ると、取得し直す", async () => {
      // Given
      loadPresets
        .mockResolvedValueOnce({ status: "offline" })
        .mockResolvedValueOnce({
          status: "ok",
          data: { personal: [], global: [globalPreset] },
        });
      render(<RoundPresetSelect />);
      await screen.findByText(roundsText("fetchOffline"));

      // When
      await act(async () => fake.returnOnline());

      // Then
      expect(await screen.findByText("公式720ラウンド")).toBeInTheDocument();
      expect(loadPresets).toHaveBeenCalledTimes(2);
    });
  });

  describe("プリセットの選択", () => {
    it("取得したプリセットを表示した直後は未選択で、開始ボタンに「プリセット無しで開始」を表示する", async () => {
      // Given
      fetchResolves({
        status: "ok",
        data: { personal: [], global: [globalPreset] },
      });

      // When
      render(<RoundPresetSelect />);
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });

      // Then
      expect(
        screen.getByRole("button", { name: roundsText("startWithoutPreset") }),
      ).toBeInTheDocument();
    });

    it("個人プリセットが無ければ、個人プリセット欄に案内文を表示する", async () => {
      // Given
      fetchResolves({
        status: "ok",
        data: { personal: [], global: [globalPreset] },
      });

      // When
      render(<RoundPresetSelect />);
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });

      // Then
      expect(
        screen.getByText(roundsText("presetPersonalEmpty")),
      ).toBeInTheDocument();
    });

    it("プリセットをクリックすると選択され、開始ボタンのラベルが選択したプリセット名になる", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then
      expect(
        screen.getByRole("button", {
          name: roundsText("startWithPreset", { name: "個人練習セット" }),
        }),
      ).toBeInTheDocument();
    });

    it("選択中のプリセットを再クリックすると選択が解除され、開始ボタンは「プリセット無しで開始」に戻る", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);
      await user.click(screen.getAllByTestId("round-preset-button")[0]);
      expect(
        screen.getByRole("button", {
          name: roundsText("startWithPreset", { name: "個人練習セット" }),
        }),
      ).toBeInTheDocument();

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then
      expect(
        screen.getByRole("button", { name: roundsText("startWithoutPreset") }),
      ).toBeInTheDocument();
    });

    it("選択中に別のプリセットをクリックすると、そのプリセットへ選択が移る", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset, otherPersonalPreset], [globalPreset]);
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[1]);

      // Then
      expect(
        screen.getByRole("button", {
          name: roundsText("startWithPreset", { name: "別の個人セット" }),
        }),
      ).toBeInTheDocument();
      expect(screen.queryByText("70m")).not.toBeInTheDocument();
    });

    it("公式プリセットも選択でき、開始ボタンのラベルが変わる", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);

      // When
      const buttons = screen.getAllByTestId("round-preset-button");
      await user.click(buttons[buttons.length - 1]);

      // Then
      expect(
        screen.getByRole("button", {
          name: roundsText("startWithPreset", { name: "公式720ラウンド" }),
        }),
      ).toBeInTheDocument();
    });
  });

  describe("プリセットのメニュー", () => {
    it("個人プリセットにだけメニューボタンを表示し、公式プリセットには表示しない", async () => {
      // Given
      fetchResolves({
        status: "ok",
        data: { personal: [personalPreset], global: [globalPreset] },
      });

      // When
      render(<RoundPresetSelect />);
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      });

      // Then
      const triggers = screen.getAllByTestId("round-preset-menu-trigger");
      expect(triggers).toHaveLength(1);
      const globalRow = screen.getByText("公式720ラウンド").closest("div");
      if (!globalRow) throw new Error("global preset row not found");
      expect(
        within(globalRow).queryByTestId("round-preset-menu-trigger"),
      ).not.toBeInTheDocument();
    });
  });

  describe("選択中のプリセットの展開表示", () => {
    it("形式・弓種と、距離構成（距離・エンド構成）を展開表示する", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then
      expect(
        screen.getByTestId("round-preset-format-bow-type"),
      ).toHaveTextContent(
        roundsText("formatBowType", {
          format: "アウトドア",
          bowType: "リカーブ",
        }),
      );
      expect(screen.getByText("70m")).toBeInTheDocument();
      expect(screen.getByText("50m")).toBeInTheDocument();
      expect(
        screen.getAllByText(
          roundsText("distanceEnds", { arrowsPerEnd: "6", totalEnds: "6" }),
        ),
      ).toHaveLength(2);
    });

    it("プリセットに的が埋め込まれていない距離は「的データを取得できません」と表示する", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], []);

      // When
      await user.click(screen.getAllByTestId("round-preset-button")[0]);

      // Then
      expect(screen.getAllByText(roundsText("targetFaceMissing"))).toHaveLength(
        2,
      );
    });

    it("展開された距離構成の部分をクリックしても、選択が解除される", async () => {
      // Given
      const user = userEvent.setup();
      await renderSelect([personalPreset], [globalPreset]);
      await user.click(screen.getAllByTestId("round-preset-button")[0]);
      expect(screen.getByText("70m")).toBeInTheDocument();

      // When
      await user.click(screen.getByText("70m"));

      // Then
      expect(screen.queryByText("70m")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: roundsText("startWithoutPreset") }),
      ).toBeInTheDocument();
    });
  });

  describe("開始ボタン", () => {
    describe("プリセット未選択で押した場合", () => {
      it("プリセット無しで開始を依頼する", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([], []);

        // When
        await user.click(
          screen.getByRole("button", {
            name: roundsText("startWithoutPreset"),
          }),
        );

        // Then
        await waitFor(() => {
          expect(startRound).toHaveBeenCalledTimes(1);
        });
        expect(startRound).toHaveBeenCalledWith(null, expect.any(Function));
      });
    });

    describe("プリセットを選択して押した場合", () => {
      it("一覧の取得結果の選択中のプリセットで開始を依頼する", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);

        // When
        await user.click(
          screen.getByRole("button", {
            name: roundsText("startWithPreset", { name: "個人練習セット" }),
          }),
        );

        // Then
        await waitFor(() => {
          expect(startRound).toHaveBeenCalledTimes(1);
        });
        expect(startRound).toHaveBeenCalledWith(
          personalPreset,
          expect.any(Function),
        );
      });

      it("開始へ、マウント中は真を返す判定を渡し、アンマウント後は偽を返す", async () => {
        // Given
        const user = userEvent.setup();
        const { unmount } = await renderSelect([personalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);

        // When
        await user.click(
          screen.getByRole("button", {
            name: roundsText("startWithPreset", { name: "個人練習セット" }),
          }),
        );

        // Then
        await waitFor(() => expect(startRound).toHaveBeenCalled());
        const isCurrent = startRound.mock.calls[0][1] as () => boolean;
        const whileMounted = isCurrent();
        unmount();
        expect(whileMounted).toBe(true);
        expect(isCurrent()).toBe(false);
      });
    });

    describe("送信中に再度押した場合", () => {
      it("開始中に開始ボタンを再度押しても、開始を1回だけ行う", async () => {
        // Given
        const deferred = createDeferred<{
          status: "created";
          roundId: string;
        }>();
        startRound.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        await renderSelect([], []);
        const button = screen.getByRole("button", {
          name: roundsText("startWithoutPreset"),
        });
        await user.click(button);
        await waitFor(() => {
          expect(startRound).toHaveBeenCalled();
        });

        // When
        await user.click(button);

        // Then
        expect(startRound).toHaveBeenCalledTimes(1);
      });

      it("開始が完了した後も、開始ボタンを押せない表示のままにする", async () => {
        // Given
        const deferred = createDeferred<{
          status: "created";
          roundId: string;
        }>();
        startRound.mockReturnValue(deferred.promise);
        const user = userEvent.setup();
        await renderSelect([], []);
        const button = screen.getByRole("button", {
          name: roundsText("startWithoutPreset"),
        });
        await user.click(button);
        await waitFor(() => {
          expect(startRound).toHaveBeenCalled();
        });
        await user.click(button);

        // When
        deferred.resolve({ status: "created", roundId: "new-round-id" });

        await flushMacrotask();

        // Then
        expect(button).toHaveAttribute("aria-disabled", "true");
      });
    });

    describe("開始できなかった場合", () => {
      it("エラーを表示し、開始ボタンを再度押せる表示に戻す", async () => {
        // Given
        startRound.mockResolvedValue({
          status: "failed",
          error: "unauthenticated",
        });
        const user = userEvent.setup();
        await renderSelect([], []);

        // When
        await user.click(
          screen.getByRole("button", {
            name: roundsText("startWithoutPreset"),
          }),
        );

        // Then
        expect(
          await screen.findByText(roundsText("fetchFailure.unauthenticated")),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", {
            name: roundsText("startWithoutPreset"),
          }),
        ).toHaveAttribute("aria-disabled", "false");
      });
    });
  });

  describe("個人プリセットの削除", () => {
    async function openDeleteDialog(
      user: ReturnType<typeof userEvent.setup>,
      presetName: string,
    ) {
      const row = screen.getByText(presetName).closest("div");
      if (!row) throw new Error(`preset row not found: ${presetName}`);
      await user.click(within(row).getByTestId("round-preset-menu-trigger"));
      await user.click(await screen.findByTestId("round-preset-delete"));
    }

    describe("削除を確定した場合", () => {
      it("選択中のプリセットを削除すると、一覧から取り除き選択を解除する", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);
        await openDeleteDialog(user, "個人練習セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
        await waitFor(() => {
          expect(screen.queryByText("個人練習セット")).not.toBeInTheDocument();
        });
        expect(deletePreset).toHaveBeenCalledWith(
          "preset-personal",
          expect.any(Function),
        );
        expect(
          screen.getByRole("button", {
            name: roundsText("startWithoutPreset"),
          }),
        ).toBeInTheDocument();
      });

      it("選択中とは別のプリセットを削除すると、一覧から取り除き選択は維持する", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([personalPreset, otherPersonalPreset], []);
        await user.click(screen.getAllByTestId("round-preset-button")[0]);
        await openDeleteDialog(user, "別の個人セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
        await waitFor(() => {
          expect(screen.queryByText("別の個人セット")).not.toBeInTheDocument();
        });
        expect(
          screen.getByRole("button", {
            name: roundsText("startWithPreset", { name: "個人練習セット" }),
          }),
        ).toBeInTheDocument();
      });
    });

    describe("削除を取りやめた場合", () => {
      it("確認ダイアログでキャンセルすると、削除せず、プリセットは一覧に残る", async () => {
        // Given
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await openDeleteDialog(user, "個人練習セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-cancel"));

        // Then
        expect(deletePreset).not.toHaveBeenCalled();
        expect(screen.getByText("個人練習セット")).toBeInTheDocument();
      });
    });

    describe("削除に失敗した場合", () => {
      it("エラーを表示し、一覧から取り除かない", async () => {
        // Given
        deletePreset.mockResolvedValue({
          status: "failed",
          error: "deleteFailed",
        });
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await openDeleteDialog(user, "個人練習セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
        expect(
          await screen.findByText(
            roundsText("presetDeleteFailure.deleteFailed"),
          ),
        ).toBeInTheDocument();
        expect(screen.getByText("個人練習セット")).toBeInTheDocument();
      });

      it("削除確認ダイアログは開いたままで、確認ボタンを再度押せる", async () => {
        // Given
        deletePreset.mockResolvedValue({
          status: "failed",
          error: "deleteFailed",
        });
        const user = userEvent.setup();
        await renderSelect([personalPreset], []);
        await openDeleteDialog(user, "個人練習セット");

        // When
        await user.click(screen.getByTestId("confirm-dialog-confirm"));

        // Then
        expect(
          await screen.findByText(
            roundsText("presetDeleteFailure.deleteFailed"),
          ),
        ).toBeInTheDocument();
        expect(screen.getByTestId("confirm-dialog-confirm")).toBeEnabled();
        expect(
          screen.getByTestId("confirm-dialog-confirm"),
        ).not.toHaveAttribute("aria-disabled", "true");
      });
    });
  });
});

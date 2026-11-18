import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSessionReader } from "@/features/auth/application/session-reader-test-helpers";
import { LeftPanel } from "@/features/navigation/ui/left-panel";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { installFakeViewport } from "@/lib/viewport/fake-viewport-test-helpers";
import { createContentFetcher } from "../application/content-fetcher";
import {
  createRoundFetching,
  type RoundQueries,
} from "../application/round-fetching";
import { createTestRounds } from "../application/round-record-test-helpers";
import { createRoundsListStore } from "../application/rounds-list-store";
import { whenOnline } from "../application/when-online";
import type { QueryOutcome } from "../domain/query-outcome";
import type { ServerHistoryPage } from "../domain/round-list";
import { installFakeIntersectionObserver } from "./intersection-observer-test-helpers";
import {
  fakeSearchParams,
  followReplaceState,
} from "./navigation-test-helpers";
import { createFakeRoundProcedures } from "./round-stores-test-helpers";
import {
  RoundProceduresProvider,
  RoundsListStoreProvider,
  RoundWindowProvider,
} from "./rounds-context";
import { RoundsHistory } from "./rounds-history";
import { RoundsHome } from "./rounds-home";

const route = vi.hoisted(() => ({ pathname: "/rounds/history" }));
vi.mock("next/navigation", async () => {
  const { fakeSearchParams: fake } = await import("./navigation-test-helpers");
  return {
    usePathname: () => route.pathname,
    useSearchParams: fake.useSearchParams,
  };
});

const navigationText = translatorFor("navigation");
const roundsText = translatorFor("rounds");
const complete: QueryOutcome<ServerHistoryPage> = {
  status: "ok",
  data: {
    rounds: [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "午前練習",
        round_date: "2026-09-15",
        format: "outdoor",
        bow_type: "recurve",
        total: 300,
        distances: [{ distance: 70, is_marked: true, total: 300 }],
      },
    ],
    hasMore: false,
  },
};
let viewport: ReturnType<typeof installFakeViewport>;

beforeEach(() => {
  viewport = installFakeViewport();
  route.pathname = "/rounds/history";
  fakeSearchParams.reset();
  followReplaceState();
  installFakeIntersectionObserver();
});

afterEach(() => {
  cleanup();
  viewport.restore();
  fakeSearchParams.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// パネル・画面・取得手続き・端末の窓口は実物を接続し、通信と端末の保存先だけを制御する。
async function prepare(state = "成功", home = false) {
  const tab = createTestRounds({ offline: state === "オフライン" });
  await tab.hub.ready();
  const roundsList = vi.fn<RoundQueries["roundsList"]>();
  roundsList.mockResolvedValue(complete);
  if (state === "取得中") roundsList.mockReturnValue(new Promise(() => {}));
  if (state === "空")
    roundsList.mockResolvedValue({
      status: "ok",
      data: { rounds: [], hasMore: false },
    });
  if (state === "通信失敗") roundsList.mockResolvedValue({ status: "failed" });
  const fetching = createRoundFetching({
    content: createContentFetcher({
      sessionReader: createFakeSessionReader().sessionReader,
      connectivity: tab.connectivity,
      clock: tab.clock,
    }),
    queries: {
      roundsList,
      roundDetail: vi.fn(),
      roundDetails: vi.fn(),
      targetFaces: vi.fn(),
      presets: vi.fn(),
    },
    snapshots: { load: () => null, save: vi.fn(), update: vi.fn() },
    clock: tab.clock,
  });
  const store = createRoundsListStore({
    hub: tab.hub,
    fetching,
    clock: tab.clock,
    connectivity: tab.connectivity,
  });
  const procedures = createFakeRoundProcedures();
  procedures.whenOnline = vi.fn((listener) =>
    whenOnline(tab.connectivity, listener),
  );
  route.pathname = home ? "/rounds" : "/rounds/history";
  const mount = () =>
    render(
      <RoundWindowProvider roundWindow={tab.roundWindow}>
        <RoundsListStoreProvider store={store}>
          <RoundProceduresProvider procedures={procedures}>
            <LeftPanel
              settings={{ open: false, onOpen: () => {}, closeFocus: "opener" }}
            >
              {home ? <RoundsHome /> : <RoundsHistory />}
            </LeftPanel>
          </RoundProceduresProvider>
        </RoundsListStoreProvider>
      </RoundWindowProvider>,
      { wrapper: IntlTestProvider },
    );
  return { roundsList, mount };
}

function panels() {
  return [...document.querySelectorAll("aside")];
}

function expectMenu(panel: HTMLElement) {
  const menu = within(panel);
  for (const key of [
    "leftPanelHome",
    "leftPanelHistory",
    "leftPanelSettings",
  ] as const) {
    const link = menu.getByRole("link", {
      name: navigationText(key),
    });
    expect(link).toHaveTextContent(navigationText(key));
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  }
}

async function waitForBody(state: string) {
  if (state === "取得中")
    expect(screen.getByRole("status")).toHaveTextContent(
      roundsText("fetchLoading"),
    );
  if (state === "空")
    expect(await screen.findByText(roundsText("historyEmpty"))).toBeVisible();
  if (state === "成功")
    expect(await screen.findByText("午前練習")).toBeVisible();
  if (state === "通信失敗")
    expect(await screen.findByRole("alert")).toHaveTextContent(
      roundsText("fetchFailure.failed"),
    );
  if (state === "オフライン")
    expect(await screen.findByText(roundsText("fetchOffline"))).toBeVisible();
}

async function toggleMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen
      .getAllByRole("button", { name: navigationText("leftPanelOpenMenu") })
      .at(-1) as HTMLElement,
  );
}

describe("点数一覧とメニューの接続", () => {
  describe.each([false, true])("広い画面=%s", (wide) => {
    it.each(["取得中", "空", "成功", "通信失敗", "オフライン"])(
      "%sでもメニューの3項目と見出しが整合する",
      async (state) => {
        // Given
        viewport.setWide(wide);
        const rig = await prepare(state);
        const user = userEvent.setup();

        // When
        rig.mount();
        await waitForBody(state);
        if (!wide) await toggleMenu(user);

        // Then
        expectMenu(panels()[wide ? 1 : 0]);
        // 開いたドロワーは本文をinertにするため、見出しをアクセシビリティツリーから探索しない。
        expect(
          screen.getByRole("heading", { level: 1, hidden: true }),
        ).toHaveTextContent(roundsText("historyTitle"));
      },
    );
  });

  it.each([false, true])(
    "ホームでメニューを開閉しても履歴を取得しない（広い画面=%s）",
    async (wide) => {
      // Given
      viewport.setWide(wide);
      const rig = await prepare("成功", true);
      const user = userEvent.setup();
      rig.mount();
      await screen.findByText(roundsText("homeEmpty"));

      // When
      if (wide)
        await user.click(
          within(panels()[1]).getByRole("button", {
            name: navigationText("leftPanelCloseMenu"),
          }),
        );
      await toggleMenu(user);

      // Then
      expect(rig.roundsList).not.toHaveBeenCalled();
      expect(
        screen.getByRole("heading", { level: 1, hidden: true }),
      ).toHaveTextContent(roundsText("homeTitle"));
    },
  );

  it.each(["取得中", "成功"])(
    "%sの点数一覧でメニューを開閉しても取得要求を追加しない",
    async (state) => {
      // Given
      const rig = await prepare(state);
      const pending = Promise.withResolvers<QueryOutcome<ServerHistoryPage>>();
      if (state === "取得中") rig.roundsList.mockReturnValue(pending.promise);
      const user = userEvent.setup();
      rig.mount();
      await waitForBody(state);
      await act(async () => {});
      const before = rig.roundsList.mock.calls.length;

      // When
      await toggleMenu(user);
      await user.click(
        within(panels()[0]).getByRole("button", {
          name: navigationText("leftPanelCloseMenu"),
        }),
      );
      await toggleMenu(user);
      if (state === "取得中") await act(async () => pending.resolve(complete));

      // Then
      expect(before).toBeGreaterThan(0);
      expect(rig.roundsList).toHaveBeenCalledTimes(before);
      expect(screen.getByText("午前練習")).toBeInTheDocument();
      expectMenu(panels()[0]);
    },
  );

  it("通信失敗後に再試行すると成功表示になり見出しとメニューの名称を保つ", async () => {
    // Given
    const rig = await prepare("通信失敗");
    const user = userEvent.setup();
    rig.mount();
    await waitForBody("通信失敗");
    rig.roundsList.mockResolvedValue(complete);

    // When
    await user.click(
      screen.getByRole("button", { name: roundsText("fetchRetry") }),
    );

    // Then
    expect(await screen.findByText("午前練習")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      roundsText("historyTitle"),
    );
    for (const panel of panels()) expectMenu(panel);
  });
});

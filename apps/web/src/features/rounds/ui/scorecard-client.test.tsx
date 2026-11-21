import "fake-indexeddb/auto";
import { setImmediate as realSetImmediate } from "node:timers";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootClientEntry } from "@/app/root-client-entry";
import { createBrowserIdentityStore } from "@/features/auth/infrastructure/browser-identity-store";
import type { RoundBaseRecord } from "@/features/rounds/domain/round-base";
import type { RoundConfig } from "@/features/rounds/domain/round-config";
import { roundTablesFromServer } from "@/features/rounds/domain/round-op-test-helpers";
import { roundStreamRules } from "@/features/rounds/domain/round-retention";
import type { Distance, Shot } from "@/features/rounds/domain/scorecard-types";
import {
  roundStreamId,
  type SyncOperation,
} from "@/features/rounds/domain/sync-events";
import type { TargetFaceOption } from "@/features/rounds/domain/target-face";
import { TARGET_FACE_SELECT } from "@/features/rounds/infrastructure/reference-query-constants";
import { useRoundWindow } from "@/features/rounds/ui/rounds-context";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createIndexedDbOpLogStore } from "@/lib/local-op-log/infrastructure/indexeddb-op-log-store";
import { loadStreamGroup } from "@/lib/local-op-log/op-log-store-test-helpers";
import { ScorecardClient } from "./scorecard-client";
import { useRoundScreen } from "./use-round-screen";

// 輪を1つだけ持つ的。的の表示は輪を持つ的を前提にする。
const SINGLE_RING_SPOTS = [
  {
    center_x: 0,
    center_y: 0,
    target_face_rings: [
      {
        radius: 1,
        color: "#FFFFFF",
        line_color: null,
        z_index: 1,
        score_str: "M",
        score_int: 0,
      },
    ],
  },
];

const roundsText = translatorFor("rounds");

// 更新の案内は別のテストで確かめるため、何も描かない代役に差し替える(起動地点のRootClientEntryが描く)。
vi.mock("@/features/offline-pwa/ui/sw-update-activator", () => ({
  SwUpdateActivator: () => null,
}));

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

// SupabaseのSDKは外部サービスとの境界のため、セッションの取得結果とRPCの結果を任意に制御できるスタブで模す。
// 画面の操作は、実物のSupabaseクライアントラッパー・操作の列を通してこのスタブのrpcに届く。
const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      getSession: supabase.getSession,
      // 認証状態の変化は起こさない。購読と解除だけを受ける。
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
    rpc: supabase.rpc,
  }),
}));

// 実際のマクロタスク境界まで進め、その時点までに積まれたマイクロタスクを、実装の非同期処理の段数によらず全て処理する。
// 「まだ起きていないこと」は条件が満たされるまで待つ形では確かめられないため、これで進めてから検証する。
// fake timersはグローバルのタイマーだけを置き換えるため、node:timersのsetImmediateはfake timers中も実際のマクロタスクとして進む。
async function flushMicrotasks() {
  await act(async () => {
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  });
}

// fake timers中はwaitFor・findByがタイマーに依存して進まないため、実際のマクロタスクを1つずつ進めながら、期待する状態になるまで検証を繰り返す。
// 上限に達した場合は、最後の検証の失敗をそのまま投げる。
async function pollWithRealTasks(
  assertion: () => void | Promise<void>,
  maxTasks = 200,
) {
  let lastError: unknown;
  for (let i = 0; i < maxTasks; i += 1) {
    await flushMicrotasks();
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

const targetFaceX: TargetFaceOption = {
  id: "face-x",
  name: "10点的",
  size: 122,
  format: "outdoor",
  bow_type: ["recurve", "compound"],
  target_face_spots: [
    {
      center_x: 0,
      center_y: 0,
      target_face_rings: [
        {
          radius: 1,
          color: "#FFF200",
          line_color: null,
          z_index: 10,
          score_str: "X",
          score_int: 10,
        },
        {
          radius: 2,
          color: "#FFF200",
          line_color: "#000000",
          z_index: 9,
          score_str: "10",
          score_int: 10,
        },
        {
          radius: 3,
          color: "#FFF200",
          line_color: "#000000",
          z_index: 8,
          score_str: "9",
          score_int: 9,
        },
      ],
    },
  ],
};

const targetFaceNoX: TargetFaceOption = {
  id: "face-no-x",
  name: "6点的",
  size: 60,
  format: "field",
  bow_type: ["recurve"],
  target_face_spots: [
    {
      center_x: 0,
      center_y: 0,
      target_face_rings: [
        {
          radius: 1,
          color: "#FFF200",
          line_color: null,
          z_index: 6,
          score_str: "6",
          score_int: 6,
        },
        {
          radius: 2,
          color: "#0066B3",
          line_color: "#000000",
          z_index: 5,
          score_str: "5",
          score_int: 5,
        },
      ],
    },
  ],
};

const targetFaces = [targetFaceX, targetFaceNoX];

const distanceA = {
  id: "distance-a",
  position_key: "a",
  distance: 70,
  total_ends: 12,
  arrows_per_end: 3,
  target_face_id: targetFaceX.id,
  is_marked: true,
};

const distanceB = {
  id: "distance-b",
  position_key: "b",
  distance: 50,
  total_ends: 12,
  arrows_per_end: 3,
  target_face_id: targetFaceX.id,
  is_marked: true,
};

// 6本を並べるテストの距離(6エンド×6射)。
const distanceSix = { ...distanceA, total_ends: 6, arrows_per_end: 6 };

const roundConfig: RoundConfig = {
  name: "テストラウンド",
  roundDate: "2026-09-15",
  format: "outdoor",
  bowType: "recurve",
};

// 画面は、アプリの起動地点(実物)が渡す窓口を使う。端末に保存済みのベースと的を前もって置き、窓口が準備完了にしたスコアカードを描く。
function RoundScreenHarness({ roundId }: { roundId: string }) {
  const { view, append } = useRoundScreen(roundId);
  if (view.status !== "ok") return null;
  return (
    <ScorecardClient roundId={roundId} screen={view.data} append={append} />
  );
}

// 端末に保存済みの状態(ベースと的)を置く。保持の規則に当たらないベース(完了のラウンド)も置くため、保持の判定を常に真にした保存を使う。
async function seedDevice(base: RoundBaseRecord, faces: TargetFaceOption[]) {
  createBrowserIdentityStore().write("user-1");
  window.localStorage.setItem(
    "aims:reference:target-faces:user-1",
    JSON.stringify({ shape: TARGET_FACE_SELECT, startedAt: 1, data: faces }),
  );
  const seeding = createIndexedDbOpLogStore<SyncOperation, RoundBaseRecord>({
    ...roundStreamRules,
    keeps: () => true,
  });
  await seeding.commit(roundStreamId("round-1"), "user-1", base, 1);
}

async function setup(
  overrides: {
    initialRoundConfig?: RoundConfig;
    distances?: Distance[];
    initialShots?: Shot[];
    targetFaces?: TargetFaceOption[];
    status?: "in_progress" | "completed";
  } = {},
) {
  const {
    status = "in_progress",
    initialRoundConfig = roundConfig,
    distances = [distanceA],
    initialShots = [],
    targetFaces: faces = targetFaces,
  } = overrides;
  await seedDevice(
    {
      tables: roundTablesFromServer({
        status,
        roundConfig: initialRoundConfig,
        distances,
        shots: initialShots,
      }),
      revisions: { round: 1, distances: {}, shots: {} },
    },
    faces,
  );
  const rendered = render(<RoundScreenHarness roundId="round-1" />, {
    wrapper: AppWrapper,
  });
  // 窓口が記録の読み込みを終えて準備完了にするまで待つ。
  await pollWithRealTasks(() => {
    expect(screen.getByTestId("round-summary")).toBeInTheDocument();
  });
  return rendered;
}

// 取得した矢の行。矢はマス(距離、エンド、マスの番号)で指す。
function shotRow(
  distanceId: string,
  end: number,
  shotNumber: number,
  scoreStr: string,
  scoreInt: number,
): Shot {
  return {
    distance_id: distanceId,
    end_number: end,
    shot_number: shotNumber,
    shooter_id: "user-1",
    score_str: scoreStr,
    score_int: scoreInt,
  };
}

// 距離の全てのマスを埋める、取得した矢の行。
function fullEndShots(distance: Distance): Shot[] {
  return Array.from(
    { length: distance.total_ends * distance.arrows_per_end },
    (_, i) =>
      shotRow(
        distance.id,
        Math.floor(i / distance.arrows_per_end) + 1,
        (i % distance.arrows_per_end) + 1,
        "10",
        10,
      ),
  );
}

// エンドの全てのマスを、番号順に返す。記録済みのマスは点数、空のマスは空文字。
function cellsOf(distanceNumber: number, end: number): string[] {
  return within(screen.getByTestId(`end-row-${distanceNumber}-${end}`))
    .getAllByTestId(/^shot-cell-/)
    .map((cell) =>
      cell.hasAttribute("data-empty") ? "" : (cell.textContent ?? ""),
    );
}

// エンドの記録済みのマスの点数を、番号順に返す。
function ballsOf(distanceNumber: number, end: number): string[] {
  return cellsOf(distanceNumber, end).filter((score) => score !== "");
}

// 指しているマスのtestid。何も指していなければnull。
function pointedCell(): string | null {
  const pointed = document.querySelectorAll("[data-ring='cell']");
  expect(pointed.length).toBeLessThanOrEqual(1);
  return pointed[0]?.getAttribute("data-testid") ?? null;
}

// 効いた操作の判定結果。
const APPLIED = {
  revision: 2,
  applied: true,
  applied_fields: null,
  rejected_fields: [],
  reason: null,
};

// RPCの成功は、判定結果を返す。マスの操作は、渡した件数分の配列を返す。
function rpcSucceeds(_name: string, args?: { p_shots?: unknown[] }) {
  let data: unknown = APPLIED;
  if (args?.p_shots) data = args.p_shots.map(() => APPLIED);
  return Promise.resolve({ data, error: null });
}

// 保存先(fake-indexeddb)の初回の接続は、負荷が高いと操作の間隔を超えるため、操作の間隔を広げて、次の操作や検証が保存の途中と重ならないようにする。
const userEventSetup = userEvent.setup.bind(userEvent);

// 別経路の追記を模すため、アプリの起動地点(実物)が渡す窓口を覚える。
let appWindow: ReturnType<typeof useRoundWindow> | undefined;

function WindowProbe() {
  appWindow = useRoundWindow();
  return null;
}

function AppWrapper({ children }: { children: ReactNode }) {
  return (
    <RootClientEntry>
      <WindowProbe />
      {children}
    </RootClientEntry>
  );
}

// 別経路の追記を模す。
function appendFromOtherPath(operation: SyncOperation) {
  return appWindow?.append("round-1", operation);
}

// 端末に保存されたround-1の操作の、確定の有無。送信の状態は画面に出ず、内部の状態は観測できないため、保存と確定の有無で確かめる。
async function ackedStates(): Promise<("acked" | "unacked")[]> {
  const store = createIndexedDbOpLogStore(roundStreamRules);
  const group = await loadStreamGroup(
    store,
    roundStreamId("round-1"),
    createBrowserIdentityStore().read(),
  );
  return group.entries.map((entry) =>
    entry.ackedRevision === undefined ? "unacked" : "acked",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(userEvent, "setup").mockImplementation((options) =>
    userEventSetup({ delay: 10, ...options }),
  );
  // IndexedDBはfake-indexeddbで代替し、テストごとに空のDBから始める。
  globalThis.indexedDB = new IDBFactory();
  appWindow = undefined;
  window.localStorage.clear();
  setOnline(true);
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  supabase.rpc.mockImplementation(rpcSucceeds);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollBy = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

// 種別・弓種の選択欄を開き、名前の選択肢を選ぶ。
async function chooseFilter(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  optionName: string,
) {
  await user.click(screen.getByTestId(testId));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

describe("ScorecardClient 初期表示・集計", () => {
  it("スコアを入力すると、エンド小計・距離の集計・ラウンド全体の集計に反映される", async () => {
    // Given
    const user = userEvent.setup();
    await setup();

    // When
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-X"));

    // Then
    await waitFor(() =>
      expect(screen.getByTestId("end-subtotal-1-1")).toHaveTextContent("20"),
    );
    expect(screen.getByTestId("end-subtotal-1-2")).toHaveTextContent("");
    expect(screen.getByTestId("distance-summary-1")).toHaveTextContent(
      roundsText("distanceSubtotal", { total: "20" }),
    );
    expect(screen.getByTestId("distance-top-scores-1")).toHaveTextContent(
      "10: 2 / X: 1",
    );
    expect(screen.getByTestId("round-top-scores")).toHaveTextContent(
      "10: 2 / X: 1",
    );
    expect(
      screen.getByText(roundsText("roundTotal", { total: "20" })),
    ).toBeInTheDocument();
  });

  it("距離間で的の点数構成が異なる場合、ラウンド全体の最高点数などは表示せず、距離ごとには表示する", async () => {
    // Given

    // When
    await setup({
      distances: [
        distanceA,
        { ...distanceB, target_face_id: targetFaceNoX.id },
      ],
      initialShots: [shotRow(distanceB.id, 1, 1, "5", 5)],
    });

    // Then
    expect(screen.queryByTestId("round-top-scores")).not.toBeInTheDocument();
    expect(screen.getByTestId("distance-top-scores-2")).toHaveTextContent(
      "6: 0 / 5: 1",
    );
    expect(
      screen.getByText(roundsText("roundTotal", { total: "5" })),
    ).toBeInTheDocument();
  });

  it("距離の的で最高点数などを集計できない場合、その距離の最高点数などは表示しない", async () => {
    // Given

    // When
    const targetFaceBlank: TargetFaceOption = {
      id: "face-blank",
      name: "未設定の的",
      size: 40,
      format: "outdoor",
      bow_type: ["recurve"],
      target_face_spots: SINGLE_RING_SPOTS,
    };
    await setup({
      distances: [{ ...distanceA, target_face_id: targetFaceBlank.id }],
      targetFaces: [targetFaceBlank],
    });

    // Then
    expect(
      screen.queryByTestId("distance-top-scores-1"),
    ).not.toBeInTheDocument();
  });

  describe("的の表示", () => {
    const shotOnA = shotRow(distanceA.id, 1, 1, "9", 9);

    it("的の一覧が空で取得が完了している場合は、「的データを取得できません」を表示し、距離・射数/エンド・エンド数と記録済みの点数は維持する", async () => {
      // Given

      // When
      await setup({ targetFaces: [], initialShots: [shotOnA] });

      // Then
      const row = screen.getByTestId("distance-config-toggle-1");
      expect(row).toHaveTextContent(roundsText("targetFaceMissing"));
      expect(row).toHaveTextContent("70m");
      expect(row).toHaveTextContent(
        roundsText("distanceEnds", { arrowsPerEnd: "3", totalEnds: "12" }),
      );
      expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("9");
    });

    it("的の一覧に距離の的があれば、サイズを表示する", async () => {
      // Given

      // When
      await setup();

      // Then
      expect(screen.getByTestId("distance-config-toggle-1")).toHaveTextContent(
        `${targetFaceX.size}cm`,
      );
    });
  });

  it("距離が1件も無い場合は追加ボタンのみを表示する", async () => {
    // Given

    // When
    await setup({ distances: [] });

    // Then
    expect(screen.queryByTestId("round-top-scores")).not.toBeInTheDocument();
    expect(screen.queryByTestId("distance-summary-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("add-distance-button")).toBeInTheDocument();
  });

  it("エンドは射数/エンドの個数のマスを番号順に表示し、空のマスも表示する", async () => {
    // Given

    // When
    await setup({
      initialShots: [
        shotRow(distanceA.id, 1, 1, "10", 10),
        shotRow(distanceA.id, 1, 3, "8", 8),
      ],
    });

    // Then
    expect(cellsOf(1, 1)).toEqual(["10", "", "8"]);
    expect(cellsOf(1, 2)).toEqual(["", "", ""]);
  });

  it("全てのマスが埋まっている場合、マウント時に何も指さず、テンキーも出さない", async () => {
    // Given

    // When
    await setup({ initialShots: fullEndShots(distanceA) });

    // Then
    expect(screen.queryByTestId("score-button-10")).not.toBeInTheDocument();
    expect(pointedCell()).toBeNull();
  });

  it("構成の範囲外のマスの矢が記録されていても、範囲外のマスは描かない", async () => {
    // Given
    const overflowing = [
      shotRow(distanceA.id, 1, 1, "10", 10),
      shotRow(distanceA.id, 1, 4, "7", 7),
    ];

    // When
    await setup({ initialShots: overflowing });

    // Then
    expect(cellsOf(1, 1)).toEqual(["10", "", ""]);
    expect(screen.queryByTestId("shot-cell-1-1-4")).not.toBeInTheDocument();
  });

  it("テンキーの閉じるボタンで何も指さなくすると、格納中のテンキーへの入力は無視される", async () => {
    // Given
    const user = userEvent.setup();
    await setup();

    // When
    await user.click(screen.getByTestId("keypad-toggle"));
    await user.click(screen.getByTestId("score-button-10"));

    // Then
    expect(ballsOf(1, 1)).toEqual([]);
    expect(pointedCell()).toBeNull();
    await flushMicrotasks();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("距離が無いラウンド（カスタム開始直後）は、ラウンド構成が展開された状態で表示する", async () => {
    // Given
    // When
    await setup({ distances: [] });

    // Then
    expect(screen.getByTestId("round-config-date")).toBeInTheDocument();
  });

  it("ヘッダーの見出しの中に、ラウンド名のボタンを出し、概要には名前を含めない", async () => {
    // Given
    // When
    await setup();

    // Then
    const name = screen.getByRole("button", {
      name: roundsText("roundNameEditNamed", { name: "テストラウンド" }),
    });
    expect(name.closest("h1")).not.toBeNull();
    expect(screen.getByTestId("round-config-summary")).not.toHaveTextContent(
      "テストラウンド",
    );
  });

  it("距離があるラウンド（プリセット開始など）は、ラウンド構成が折りたたまれた状態で表示する", async () => {
    // Given
    // When
    await setup();

    // Then
    expect(screen.queryByTestId("round-config-date")).not.toBeInTheDocument();
  });
});

// 操作の列がSDKへ送った矢の操作を、呼び出しをまたいで順に並べる。
function sentShots(rpcName: "record_shots" | "clear_shots") {
  return supabase.rpc.mock.calls
    .filter(([name]) => name === rpcName)
    .flatMap(([, args]) => args.p_shots);
}

describe("ScorecardClient マスを指す・点数を書く", () => {
  // 入力中で空のマスがあるラウンドは、マウント時点で最初の空のマスを指し、テンキーが開いている。

  it("開いた直後は、最初の空のマスを指す", async () => {
    // Given

    // When
    await setup({
      initialShots: [
        shotRow(distanceA.id, 1, 1, "10", 10),
        shotRow(distanceA.id, 1, 3, "8", 8),
      ],
    });

    // Then
    expect(pointedCell()).toBe("shot-cell-1-1-2");
  });

  it("エンドが埋まっているとき、開いた直後は後ろのエンドの最初の空のマスを指す", async () => {
    // Given

    // When
    await setup({
      initialShots: [1, 2, 3].map((n) => shotRow(distanceA.id, 1, n, "10", 10)),
    });

    // Then
    expect(pointedCell()).toBe("shot-cell-1-2-1");
  });

  it("記録済みのマスは点数を表示し、空のマスは数字の文字を描かない", async () => {
    // Given

    // When
    await setup({ initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)] });

    // Then
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("10");
    expect(screen.getByTestId("shot-cell-1-1-2")).toHaveTextContent(/^$/);
  });

  it("空のマスには番号と空であることの読み上げの名前を付け、記録済みのマスには名前を付けず中の点数が読まれる", async () => {
    // Given

    // When
    await setup({ initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)] });

    // Then
    expect(screen.getByTestId("shot-cell-1-1-2")).toHaveAccessibleName(
      roundsText("emptyCell", { number: "2" }),
    );
    expect(screen.getByTestId("shot-cell-1-1-3")).toHaveAccessibleName(
      roundsText("emptyCell", { number: "3" }),
    );
    expect(screen.getByTestId("shot-cell-1-1-1")).not.toHaveAttribute(
      "aria-label",
    );
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveAccessibleName("10");
  });

  it("空のマスも記録済みのマスも押せるボタンで、Tabで順に移動できる", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ initialShots: [shotRow(distanceA.id, 1, 2, "9", 9)] });
    screen.getByTestId("shot-cell-1-1-1").focus();

    // When
    await user.tab();
    const second = document.activeElement;
    await user.tab();

    // Then
    expect(second).toBe(screen.getByTestId("shot-cell-1-1-2"));
    expect(document.activeElement).toBe(screen.getByTestId("shot-cell-1-1-3"));
  });

  it("格納中に空のマスを押すと、そのマスを指して輪が付き、テンキーが展開される", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("keypad-toggle"));
    expect(pointedCell()).toBeNull();

    // When
    await user.click(screen.getByTestId("shot-cell-1-2-2"));

    // Then
    expect(pointedCell()).toBe("shot-cell-1-2-2");
    expect(screen.getByTestId("shot-cell-1-2-2")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("bottom-frame").style.minHeight).toBe("220px");
  });

  it("指しているマスを押しても、何も変わらない", async () => {
    // Given
    const user = userEvent.setup();
    await setup();

    // When
    await user.click(screen.getByTestId("shot-cell-1-1-1"));

    // Then
    expect(pointedCell()).toBe("shot-cell-1-1-1");
    expect(ballsOf(1, 1)).toEqual([]);
  });

  it("点数を順不同に書いても、書いたマスに残り、並べ替わらない", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ distances: [distanceSix] });

    // When
    for (const key of ["9", "M", "X", "10", "9"]) {
      await user.click(screen.getByTestId(`score-button-${key}`));
    }

    // Then
    await waitFor(() =>
      expect(cellsOf(1, 1)).toEqual(["9", "M", "X", "10", "9", ""]),
    );
    expect(screen.getByTestId("end-subtotal-1-1")).toHaveTextContent("38");
  });

  it("空のマスへ書くと、そのマスに記録し、他の利用者が埋めたマスを飛ばして後ろの最初の空のマスを指す", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ initialShots: [shotRow(distanceA.id, 1, 3, "8", 8)] });
    await user.click(screen.getByTestId("shot-cell-1-1-2"));

    // When
    await user.click(screen.getByTestId("score-button-9"));

    // Then
    await waitFor(() => expect(cellsOf(1, 1)).toEqual(["", "9", "8"]));
    expect(pointedCell()).toBe("shot-cell-1-2-1");
    await waitFor(() => {
      expect(sentShots("record_shots")).toEqual([
        {
          shot_event_id: expect.any(String),
          distance_id: distanceA.id,
          end_number: 1,
          shot_number: 2,
          score_str: "9",
          score_int: 9,
        },
      ]);
    });
  });

  it("エンドの最後のマスへ書くと、後ろのエンドの最初の空のマスを指す", async () => {
    // Given
    const user = userEvent.setup();
    await setup({
      initialShots: [
        shotRow(distanceA.id, 1, 1, "10", 10),
        shotRow(distanceA.id, 1, 2, "9", 9),
      ],
    });

    // When
    await user.click(screen.getByTestId("score-button-M"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10", "9", "M"]));
    expect(pointedCell()).toBe("shot-cell-1-2-1");
  });

  it("距離の最後の空のマスへ書くと、次の距離を指さずテンキーを格納し、前方の空のマスは押して埋められる", async () => {
    // Given
    const user = userEvent.setup();
    await setup({
      distances: [distanceA, distanceB],
      initialShots: fullEndShots(distanceA).filter(
        (shot) =>
          !(shot.end_number === 1 && shot.shot_number === 1) &&
          !(shot.end_number === 12 && shot.shot_number === 3),
      ),
    });
    await user.click(screen.getByTestId("shot-cell-1-12-3"));

    // When
    await user.click(screen.getByTestId("score-button-9"));

    // Then
    await waitFor(() => expect(ballsOf(1, 12)).toEqual(["10", "10", "9"]));
    expect(pointedCell()).toBeNull();
    expect(ballsOf(2, 1)).toEqual([]);
    expect(screen.getByTestId("bottom-frame").style.minHeight).toBe("0px");
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-M"));
    await waitFor(() => expect(cellsOf(1, 1)).toEqual(["M", "10", "10"]));
  });

  it("画面へ反映される前に続けて押しても、同じマスや範囲外のマスへ重ねて書かない", async () => {
    // Given
    await setup();

    // When
    fireEvent.click(screen.getByTestId("score-button-10"));
    fireEvent.click(screen.getByTestId("score-button-9"));
    fireEvent.click(screen.getByTestId("score-button-M"));
    fireEvent.click(screen.getByTestId("score-button-X"));

    // Then
    await waitFor(() => expect(cellsOf(1, 2)).toEqual(["X", "", ""]));
    expect(cellsOf(1, 1)).toEqual(["10", "9", "M"]);
    await waitFor(() => expect(sentShots("record_shots")).toHaveLength(4));
    const written = sentShots("record_shots").map(
      (shot) => `${shot.end_number}:${shot.shot_number}`,
    );
    expect(written).toEqual(["1:1", "1:2", "1:3", "2:1"]);
  });

  it("記録済みのマスを押すと、そのマスを指す", async () => {
    // Given
    const user = userEvent.setup();
    await setup({
      initialShots: [
        shotRow(distanceA.id, 1, 1, "10", 10),
        shotRow(distanceA.id, 1, 2, "9", 9),
      ],
    });

    // When
    await user.click(screen.getByTestId("shot-cell-1-1-2"));

    // Then
    expect(pointedCell()).toBe("shot-cell-1-1-2");
  });

  it("記録済みのマスへ点数を書くと、そのマスの点数だけが変わり、位置も指すマスも変わらない", async () => {
    // Given
    const user = userEvent.setup();
    await setup({
      initialShots: [
        shotRow(distanceA.id, 1, 1, "10", 10),
        shotRow(distanceA.id, 1, 2, "9", 9),
      ],
    });
    await user.click(screen.getByTestId("shot-cell-1-1-2"));

    // When
    await user.click(screen.getByTestId("score-button-X"));

    // Then
    await waitFor(() => expect(cellsOf(1, 1)).toEqual(["10", "X", ""]));
    expect(pointedCell()).toBe("shot-cell-1-1-2");
    await waitFor(() => {
      expect(sentShots("record_shots")).toEqual([
        expect.objectContaining({
          end_number: 1,
          shot_number: 2,
          score_str: "X",
        }),
      ]);
    });
    expect(sentShots("record_shots")[0]).not.toHaveProperty("shooter_id");
  });

  it("空のマスを指しているときはクリアを押せない", async () => {
    // Given

    // When
    await setup({ initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)] });

    // Then
    expect(screen.getByTestId("score-button-clear")).toBeDisabled();
  });

  it("記録済みのマスを押すと、クリアを押せるようになる", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)] });

    // When
    await user.click(screen.getByTestId("shot-cell-1-1-1"));

    // Then
    expect(screen.getByTestId("score-button-clear")).toBeEnabled();
  });

  it("記録済みのマスをクリアすると、そのマスだけが空になり、指したままになる", async () => {
    // Given
    const user = userEvent.setup();
    await setup({
      initialShots: [
        shotRow(distanceA.id, 1, 1, "10", 10),
        shotRow(distanceA.id, 1, 2, "9", 9),
      ],
    });
    await user.click(screen.getByTestId("shot-cell-1-1-1"));

    // When
    await user.click(screen.getByTestId("score-button-clear"));

    // Then
    await waitFor(() => expect(cellsOf(1, 1)).toEqual(["", "9", ""]));
    expect(pointedCell()).toBe("shot-cell-1-1-1");
    expect(screen.getByTestId("score-button-clear")).toBeDisabled();
    await waitFor(() => {
      expect(sentShots("clear_shots")).toEqual([
        {
          shot_event_id: expect.any(String),
          distance_id: distanceA.id,
          end_number: 1,
          shot_number: 1,
        },
      ]);
    });
  });

  it("番号・小計を押しても、指すマスとテンキーは変わらない", async () => {
    // Given
    const user = userEvent.setup();
    await setup();

    // When
    await user.click(screen.getByTestId("end-subtotal-1-2"));
    await user.click(within(screen.getByTestId("end-row-1-2")).getByText("2"));

    // Then
    expect(pointedCell()).toBe("shot-cell-1-1-1");
    expect(screen.getByTestId("score-button-10")).toBeInTheDocument();
  });

  it("別の距離のマスを押すと、その距離の的のキーに切り替わる", async () => {
    // Given
    const user = userEvent.setup();
    await setup({
      distances: [
        distanceA,
        { ...distanceB, target_face_id: targetFaceNoX.id },
      ],
    });
    expect(screen.getByTestId("score-button-X")).toBeInTheDocument();

    // When
    await user.click(screen.getByTestId("shot-cell-2-1-1"));

    // Then
    expect(screen.queryByTestId("score-button-X")).not.toBeInTheDocument();
    expect(screen.getByTestId("score-button-6")).toBeInTheDocument();
  });

  it("書く・消す・他の端末の変化のどれでも、マスを動かす処理を呼ばず、その場で描き替える", async () => {
    // Given
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate;
    const user = userEvent.setup();
    await setup();

    // When
    await user.click(screen.getByTestId("score-button-10"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-clear"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
    await act(() =>
      appendFromOtherPath({
        type: "shot.recorded",
        eventId: "e-other-1",
        distanceId: distanceA.id,
        endNumber: 1,
        shotNumber: 2,
        scoreStr: "9",
        scoreInt: 9,
      }),
    );
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));

    // Then
    expect(animate).not.toHaveBeenCalled();
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });

  it("構成の変更で指しているマスが範囲外になると、そのマスは描かず何も指さなくなる", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("shot-cell-1-1-3"));

    // When
    await act(() =>
      appendFromOtherPath({
        type: "distance.updated",
        eventId: "e-other-config",
        distanceId: distanceA.id,
        changes: {
          config: {
            totalEnds: 12,
            arrowsPerEnd: 2,
            targetFaceId: targetFaceX.id,
          },
        },
      }),
    );

    // Then
    await waitFor(() =>
      expect(screen.queryByTestId("shot-cell-1-1-3")).not.toBeInTheDocument(),
    );
    expect(cellsOf(1, 1)).toEqual(["", ""]);
    expect(pointedCell()).toBeNull();
  });

  it("複数スポットの的では、テンキーに点数のキーを重複なく、リング色で表示する", async () => {
    // Given

    // When
    const targetFaceTriple: TargetFaceOption = {
      id: "face-triple",
      name: "トリプルスポット",
      size: 40,
      format: "indoor",
      bow_type: ["recurve"],
      target_face_spots: [0, 1].map((index) => ({
        center_x: index,
        center_y: 0,
        target_face_rings: [
          {
            radius: 1,
            color: "#FFF200",
            line_color: null,
            z_index: 10,
            score_str: "10",
            score_int: 10,
          },
          {
            radius: 2,
            color: "#0066B3",
            line_color: "#000000",
            z_index: 9,
            score_str: "9",
            score_int: 9,
          },
        ],
      })),
    };
    await setup({
      distances: [{ ...distanceA, target_face_id: targetFaceTriple.id }],
      targetFaces: [targetFaceTriple],
    });

    // Then
    expect(screen.getAllByTestId("score-button-10")).toHaveLength(1);
    expect(screen.getAllByTestId("score-button-9")).toHaveLength(1);
    expect(screen.getByTestId("score-button-9")).toHaveStyle({
      backgroundColor: "#0066B3",
    });
    expect(screen.getByTestId("score-button-M")).toBeInTheDocument();
  });
});

describe("ScorecardClient 玉の折り返し", () => {
  it("玉の領域に射数/エンド分のマスが収まらないときは、射数/エンドから決めた段の数の高さを確保する", async () => {
    // Given
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe() {
          this.callback(
            [{ contentRect: { width: 108, height: 0 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );

    // When
    await setup({ distances: [distanceSix] });

    // Then
    const area = screen.getByTestId("shot-cell-1-1-1").parentElement;
    expect(area).toHaveStyle({ minHeight: "80px" });
  });

  it("射数/エンド分のマスを、段の数で割った同じ数の列に、左上から番号順に並べる", async () => {
    // Given
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe() {
          this.callback(
            [{ contentRect: { width: 144, height: 0 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );

    // When
    await setup({
      distances: [distanceSix],
      initialShots: [
        shotRow(distanceA.id, 1, 1, "10", 10),
        shotRow(distanceA.id, 1, 2, "9", 9),
      ],
    });

    // Then
    const area = screen.getByTestId("shot-cell-1-1-1")
      .parentElement as HTMLElement;
    expect(area).toHaveStyle({
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      minHeight: "80px",
    });
    expect(
      [...area.children].map((c) => c.getAttribute("data-testid")),
    ).toEqual([
      "shot-cell-1-1-1",
      "shot-cell-1-1-2",
      "shot-cell-1-1-3",
      "shot-cell-1-1-4",
      "shot-cell-1-1-5",
      "shot-cell-1-1-6",
    ]);
  });
});

describe("ScorecardClient テンキーの開閉と配置", () => {
  it("縦向きでテンキーの閉じるボタンを押すと、枠の高さを完了の帯だけに戻す", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    const frame = screen.getByTestId("bottom-frame");
    const heightWhileOpen = frame.style.minHeight;

    // When
    await user.click(screen.getByTestId("keypad-toggle"));

    // Then
    expect(heightWhileOpen).toBe("220px");
    expect(frame.style.minHeight).toBe("0px");
  });

  it("横向きの場合は、テンキーをボトムシートではなく横の側パネルに表示する", async () => {
    // Given
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: query === "(orientation: landscape)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    // When
    await setup();

    // Then
    expect(
      within(screen.getByTestId("keypad-panel")).getByTestId("score-button-10"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("keypad-toggle")).not.toBeInTheDocument();
  });
});

describe("ScorecardClient 指しているマスへのスクロール", () => {
  // jsdomはレイアウトを計算しないため、エンドの行とスクロール領域（<main>）の表示位置を境界として与える。
  // 未記録のラウンドはマウント時点でエンド1の最初のマスを指すため、エンド1の行の位置で検証する。
  // 上側の固定表示（data-sticky-inset）は、自身のdata-testid（round-summary）か、属する距離のdata-testid（distance-summary-N、その小計）をキーにして与える。
  // 戻り値のlayoutを書き換えると、以降の測定へ反映される。
  type Box = { top: number; bottom: number };
  function stickyKeyOf(el: Element): string {
    if (!el.hasAttribute("data-sticky-inset")) return "";
    const own = el.getAttribute("data-testid");
    if (own) return own;
    const distance = el.closest("[data-distance-card]");
    return distance?.getAttribute("data-testid") ?? "";
  }
  function stubLayout({
    cell,
    container,
    sticky = {},
    otherCells = {},
  }: {
    cell: Box;
    container: Box;
    sticky?: Record<string, Box>;
    // エンド1以外の行の位置。距離Aの行を`distance-a:エンド番号`で与える。
    otherCells?: Record<string, Box>;
  }) {
    const layout = { cell, container, sticky, otherCells };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const rect = this.hasAttribute("data-follow-container")
          ? layout.container
          : this.getAttribute("data-follow-row") === `${distanceA.id}:1`
            ? layout.cell
            : (layout.otherCells[this.getAttribute("data-follow-row") ?? ""] ??
              layout.sticky[stickyKeyOf(this)] ?? { top: 0, bottom: 0 });
        return {
          ...rect,
          x: 0,
          y: rect.top,
          left: 0,
          right: 0,
          width: 0,
          height: rect.bottom - rect.top,
          // biome-ignore lint/style/useNamingConvention: DOMRectの標準のメソッド名
          toJSON: () => ({}),
        };
      },
    );
    return layout;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 観測先ごとに大きさの変化を通知できるResizeObserverの差し替え。観測した要素を記録する。
  function stubResizeObserver() {
    const observed = new Map<
      Element,
      (width: number, height: number) => void
    >();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) {
          observed.set(element, (width, height) =>
            this.callback(
              [{ contentRect: { width, height } } as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            ),
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const target = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`${selector}が無い`);
      return element;
    };
    return {
      observed,
      // スクロール領域(<main>)の大きさが変わったことを知らせる。
      resizeContainer: () =>
        act(() => observed.get(target("[data-follow-container]"))?.(0, 800)),
      // エンドの玉の領域の幅が測れた・変わったことを知らせる。
      resizeBalls: (testId: string, width: number) =>
        act(() => {
          const grid = target(`[data-testid="${testId}"]`).querySelector(
            ".relative.grid",
          );
          if (grid) observed.get(grid)?.(width, 0);
        }),
    };
  }

  it("領域の大きさが変わったとき(テンキーの高さが測れたとき)、選択中のマスが領域の下端の格納ボタン（48px）に隠れる場合は、隠れる分だけ下へスクロールする", async () => {
    // Given
    // 高さ800の領域（テンキーの上端まで）の700〜740にマスがある。見える下端は800-格納ボタンのはみ出し48-余白16=736のため、4だけ隠れている（初期表示でもスクロールする）。
    const { resizeContainer } = stubResizeObserver();
    stubLayout({
      cell: { top: 700, bottom: 740 },
      container: { top: 0, bottom: 800 },
    });
    await setup();
    vi.mocked(Element.prototype.scrollBy).mockClear();

    // When
    resizeContainer();

    // Then
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollBy).toHaveBeenCalledWith({
      top: 4,
      behavior: "smooth",
    });
  });

  it("玉の領域の幅が測れて行の段数が変わったとき、指す行が隠れていればスクロールする", async () => {
    // Given
    const { resizeBalls } = stubResizeObserver();
    const layout = stubLayout({
      cell: { top: 100, bottom: 140 },
      container: { top: 0, bottom: 800 },
    });
    await setup();
    layout.cell = { top: 760, bottom: 790 };
    vi.mocked(Element.prototype.scrollBy).mockClear();

    // When
    // 射数/エンド3で、幅72pxには2つまで収まるため、段数が1から2になる。
    resizeBalls("end-row-1-1", 72);

    // Then
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollBy).toHaveBeenCalledWith({
      top: 790 - (800 - 48 - 16),
      behavior: "smooth",
    });
  });

  it("行の段数が変わらない幅の変化では、スクロールしない", async () => {
    // Given
    const { resizeBalls } = stubResizeObserver();
    const layout = stubLayout({
      cell: { top: 100, bottom: 140 },
      container: { top: 0, bottom: 800 },
    });
    await setup();
    layout.cell = { top: 760, bottom: 790 };
    vi.mocked(Element.prototype.scrollBy).mockClear();

    // When
    // 射数/エンド3は、幅108px(3つ収まる)でも幅144px(4つ収まる)でも1段のまま。
    resizeBalls("end-row-1-1", 108);
    resizeBalls("end-row-1-1", 144);

    // Then
    expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
  });

  it("距離を追加して内容が伸びても、別の場所へスクロールした位置は戻らない", async () => {
    // Given
    const user = userEvent.setup();
    const { observed } = stubResizeObserver();
    const layout = stubLayout({
      cell: { top: 100, bottom: 140 },
      container: { top: 0, bottom: 800 },
    });
    await setup();
    // 利用者が別の場所へスクロールし、指す行が隠れた。
    layout.cell = { top: 760, bottom: 790 };
    vi.mocked(Element.prototype.scrollBy).mockClear();

    // When
    await user.click(screen.getByTestId("add-distance-button"));
    await screen.findByTestId("distance-config-distance-2");

    // Then
    expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
    // 内容全体は観測しない。観測するのは、スクロール領域、玉の領域、テンキーだけである。
    const container = document.querySelector("[data-follow-container]");
    for (const element of observed.keys()) {
      const allowed =
        element === container ||
        element.matches(".relative.grid") ||
        element.closest(
          "[data-testid='keypad-panel'],[data-testid='bottom-frame']",
        );
      expect(allowed).toBeTruthy();
    }
  });

  it("選択中のマスが表示領域より上にある場合は、上端の余白の位置まで上へスクロールする", async () => {
    // Given
    stubLayout({
      cell: { top: -100, bottom: -60 },
      container: { top: 0, bottom: 800 },
    });

    // When
    await setup();

    // Then
    expect(Element.prototype.scrollBy).toHaveBeenLastCalledWith({
      top: -116,
      behavior: "smooth",
    });
  });

  it("指す位置とテンキーの高さが変わらないまま再描画されても、スクロールし直さない", async () => {
    // Given
    stubLayout({
      cell: { top: 760, bottom: 790 },
      container: { top: 0, bottom: 800 },
    });
    const { rerender } = await setup();
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);

    // When
    // 窓口の状態が変わらないまま、画面が再描画される。
    rerender(<RoundScreenHarness roundId="round-1" />);

    // Then
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);
  });

  it("選択中のマスが見えている場合は、スクロールしない", async () => {
    // Given
    stubLayout({
      cell: { top: 100, bottom: 140 },
      container: { top: 0, bottom: 800 },
    });

    // When
    await setup();

    // Then
    expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
  });

  it("選択中のマスが上側の固定表示の下に入る場合は、固定表示の下端の位置まで上へスクロールする", async () => {
    // Given
    stubLayout({
      cell: { top: 80, bottom: 120 },
      container: { top: 0, bottom: 800 },
      sticky: { "round-summary": { top: 56, bottom: 100 } },
    });

    // When
    await setup();

    // Then
    // 固定表示には余白を付けない。
    expect(Element.prototype.scrollBy).toHaveBeenLastCalledWith({
      top: -20,
      behavior: "smooth",
    });
  });

  it("別の距離の小計は、選択中のマスの上側の固定表示として見込まない", async () => {
    // Given
    // 2つの距離があり、エンド1の行は300〜340にある。2つ目の距離の小計の下端が500にあるが、この小計は2つ目の距離の行より上で外れているため行を隠さない。
    stubLayout({
      cell: { top: 300, bottom: 340 },
      container: { top: 0, bottom: 800 },
      sticky: { "distance-summary-2": { top: 460, bottom: 500 } },
    });

    // When
    await setup({ distances: [distanceA, distanceB] });

    // Then
    expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
  });

  it("選択中のマスの距離の小計が行に掛かる場合は、その下端の位置まで上へスクロールする", async () => {
    // Given
    stubLayout({
      cell: { top: 120, bottom: 160 },
      container: { top: 0, bottom: 800 },
      sticky: { "distance-summary-1": { top: 110, bottom: 150 } },
    });

    // When
    await setup({ distances: [distanceA, distanceB] });

    // Then
    expect(Element.prototype.scrollBy).toHaveBeenLastCalledWith({
      top: -30,
      behavior: "smooth",
    });
  });

  it("選択中のマスが上側の固定表示の下端にちょうど接する場合は、スクロールしない", async () => {
    // Given
    stubLayout({
      cell: { top: 100, bottom: 140 },
      container: { top: 0, bottom: 800 },
      sticky: { "round-summary": { top: 56, bottom: 100 } },
    });

    // When
    await setup();

    // Then
    expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
  });

  it("固定されていない小計の直下のマスを指して点数を入力して指すマスが移っても、スクロールし続けない", async () => {
    // Given
    // 1つ目の距離の小計の下端が、エンド1の行の上端（150）に接している（小計がまだ固定されていない）。
    const user = userEvent.setup();
    stubLayout({
      cell: { top: 150, bottom: 190 },
      container: { top: 0, bottom: 800 },
      sticky: { "distance-summary-1": { top: 110, bottom: 150 } },
    });
    await setup({ distances: [distanceA, distanceB] });

    // When
    await user.click(screen.getByTestId("score-button-10"));
    // 記録は直ちに画面へ反映されるが、描画を待ってから押す。
    await user.click(await screen.findByTestId("shot-cell-1-1-1"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
  });

  describe("他の端末の変化でマスの内容が変わったとき", () => {
    it("指すマスが他の端末で埋められても、指すマスは動かず、行が隠れていてもスクロールしない", async () => {
      // Given
      const layout = stubLayout({
        cell: { top: 100, bottom: 140 },
        container: { top: 0, bottom: 800 },
      });
      await setup();
      layout.cell = { top: 760, bottom: 790 };
      vi.mocked(Element.prototype.scrollBy).mockClear();

      // When
      await act(() =>
        appendFromOtherPath({
          type: "shot.recorded",
          eventId: "e-other-1",
          distanceId: distanceA.id,
          endNumber: 1,
          shotNumber: 1,
          scoreStr: "9",
          scoreInt: 9,
        }),
      );

      // Then
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));
      await flushMicrotasks();
      expect(pointedCell()).toBe("shot-cell-1-1-1");
      expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
    });

    it("指すマスが他の端末で空にされても、指すマスは動かず、行が隠れていてもスクロールしない", async () => {
      // Given
      const user = userEvent.setup();
      const layout = stubLayout({
        cell: { top: 100, bottom: 140 },
        container: { top: 0, bottom: 800 },
      });
      await setup({
        initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)],
      });
      await user.click(screen.getByTestId("shot-cell-1-1-1"));
      layout.cell = { top: 760, bottom: 790 };
      vi.mocked(Element.prototype.scrollBy).mockClear();

      // When
      await act(() =>
        appendFromOtherPath({
          type: "shot.cleared",
          eventId: "e-other-clear",
          distanceId: distanceA.id,
          endNumber: 1,
          shotNumber: 1,
        }),
      );

      // Then
      await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
      await flushMicrotasks();
      expect(pointedCell()).toBe("shot-cell-1-1-1");
      expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
    });
  });

  describe("同じエンドの中で指すマスが移る操作", () => {
    // 行が見える位置から、隠れる位置（見える下端736を超える）へ動かしてから操作する。
    function hideCell(layout: { cell: Box }) {
      layout.cell = { top: 760, bottom: 790 };
      vi.mocked(Element.prototype.scrollBy).mockClear();
    }

    function visibleLayout() {
      return stubLayout({
        cell: { top: 100, bottom: 140 },
        container: { top: 0, bottom: 800 },
      });
    }

    it("点数を記録して次のマスへ移ると、行が隠れていればスクロールする", async () => {
      // Given
      const user = userEvent.setup();
      const layout = visibleLayout();
      await setup();
      expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
      hideCell(layout);

      // When
      await user.click(screen.getByTestId("score-button-10"));

      // Then
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
      expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);
      expect(Element.prototype.scrollBy).toHaveBeenCalledWith({
        top: 790 - (800 - 48 - 16),
        behavior: "smooth",
      });
    });

    it("記録済みのマスを選ぶと、行が隠れていればスクロールする", async () => {
      // Given
      const user = userEvent.setup();
      const layout = visibleLayout();
      await setup({
        initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)],
      });
      hideCell(layout);

      // When
      await user.click(screen.getByTestId("shot-cell-1-1-1"));

      // Then
      expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);
    });

    it("一つ戻ると、行が隠れていればスクロールする", async () => {
      // Given
      const user = userEvent.setup();
      const layout = visibleLayout();
      await setup();
      await user.click(screen.getByTestId("score-button-10"));
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
      hideCell(layout);

      // When
      await user.click(screen.getByTestId("score-button-undo"));

      // Then
      await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
      expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);
    });

    it("行が見えている場合は、指すマスが移ってもスクロールしない", async () => {
      // Given
      const user = userEvent.setup();
      visibleLayout();
      await setup();

      // When
      await user.click(screen.getByTestId("score-button-10"));

      // Then
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
      expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
    });
  });

  it("横向きの場合は、テンキーの高さを見込まずにスクロールする", async () => {
    // Given
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: query === "(orientation: landscape)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    const { resizeContainer } = stubResizeObserver();
    stubLayout({
      cell: { top: 760, bottom: 790 },
      container: { top: 0, bottom: 800 },
    });
    await setup();

    // When
    // 向きが変わると領域の大きさが変わり、横向きの重なり(0)で計算し直す。
    resizeContainer();

    // Then
    expect(Element.prototype.scrollBy).toHaveBeenLastCalledWith({
      top: 6,
      behavior: "smooth",
    });
  });
});

describe("ScorecardClient 固定表示の配置", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("横向きでは、枠の高さをテンキー分に広げない", async () => {
    // Given
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: query === "(orientation: landscape)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    // When
    await setup();

    // Then
    expect(screen.getByTestId("bottom-frame").style.minHeight).toBe("0px");
  });
});

describe("ScorecardClient 一つ戻る・一つ進む", () => {
  it("開いた直後は、一つ戻る・一つ進むを押せない", async () => {
    // Given

    // When
    await setup();

    // Then
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
  });

  it("記録を戻すと、そのマスが空になって指し、一つ進むだけを押せる", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("score-button-10"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));

    // When
    await user.click(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
    expect(pointedCell()).toBe("shot-cell-1-1-1");
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeEnabled();
    await waitFor(() => {
      expect(sentShots("clear_shots")).toEqual([
        {
          shot_event_id: expect.any(String),
          distance_id: distanceA.id,
          end_number: 1,
          shot_number: 1,
        },
      ]);
    });
  });

  it("一つ戻るを続けて2回押しても、1回だけ戻り、エラーにならない", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("score-button-10"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));

    // When
    await user.dblClick(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeEnabled();
  });

  it("戻した記録を進むと、同じマスへ同じ点数が戻って指し、一つ戻るだけを押せる", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("score-button-10"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    await user.click(screen.getByTestId("score-button-undo"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));

    // When
    await user.click(screen.getByTestId("score-button-redo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    expect(pointedCell()).toBe("shot-cell-1-1-1");
    expect(screen.getByTestId("score-button-undo")).toBeEnabled();
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
    await waitFor(() => expect(sentShots("record_shots")).toHaveLength(2));
    const [first, second] = sentShots("record_shots");
    expect([second.end_number, second.shot_number, second.score_str]).toEqual([
      first.end_number,
      first.shot_number,
      first.score_str,
    ]);
  });

  it("戻した後に点数を書くと、そのマスへ記録し、やり直せなくなる", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("score-button-10"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    await user.click(screen.getByTestId("score-button-undo"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));

    // When
    await user.click(screen.getByTestId("score-button-9"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
  });

  it("戻した後に記録済みのマスを指してクリアすると、やり直せなくなる", async () => {
    // Given
    const user = userEvent.setup();
    await setup({
      initialShots: [
        shotRow(distanceA.id, 1, 1, "10", 10),
        shotRow(distanceA.id, 1, 2, "9", 9),
      ],
    });
    await user.click(screen.getByTestId("shot-cell-1-2-1"));
    await user.click(screen.getByTestId("score-button-X"));
    await waitFor(() => expect(ballsOf(1, 2)).toEqual(["X"]));
    await user.click(screen.getByTestId("score-button-undo"));
    await waitFor(() => expect(ballsOf(1, 2)).toEqual([]));
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    expect(screen.getByTestId("score-button-redo")).toBeEnabled();

    // When
    await user.click(screen.getByTestId("score-button-clear"));

    // Then
    await waitFor(() =>
      expect(screen.getByTestId("score-button-redo")).toBeDisabled(),
    );
  });

  it("直したマスを戻すと、直す前の点数だけを射手なしで書き、そのマスを指す", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)] });
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-9"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));

    // When
    await user.click(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    expect(pointedCell()).toBe("shot-cell-1-1-1");
    await waitFor(() => {
      expect(sentShots("record_shots").at(-1)).toEqual({
        shot_event_id: expect.any(String),
        distance_id: distanceA.id,
        end_number: 1,
        shot_number: 1,
        score_str: "10",
        score_int: 10,
      });
    });
  });

  it("直したマスを戻して進むと、直した点数だけを射手なしで書き、そのマスを指す", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)] });
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-9"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));
    await user.click(screen.getByTestId("score-button-undo"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));

    // When
    await user.click(screen.getByTestId("score-button-redo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));
    expect(pointedCell()).toBe("shot-cell-1-1-1");
    await waitFor(() => {
      expect(sentShots("record_shots").at(-1)).toEqual({
        shot_event_id: expect.any(String),
        distance_id: distanceA.id,
        end_number: 1,
        shot_number: 1,
        score_str: "9",
        score_int: 9,
      });
    });
  });

  it("クリアしたマスを戻すと、クリア前の点数だけが射手なしで戻る", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)] });
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-clear"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));

    // When
    await user.click(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    await waitFor(() => {
      expect(sentShots("record_shots").at(-1)).toEqual({
        shot_event_id: expect.any(String),
        distance_id: distanceA.id,
        end_number: 1,
        shot_number: 1,
        score_str: "10",
        score_int: 10,
      });
    });
  });

  it("エンドの最後のマスを記録して次のエンドへ移った直後に戻ると、前のエンドの最後のマスが空になって指される", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-9"));
    await user.click(screen.getByTestId("score-button-M"));
    await waitFor(() => expect(pointedCell()).toBe("shot-cell-1-2-1"));

    // When
    await user.click(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(cellsOf(1, 1)).toEqual(["10", "9", ""]));
    expect(pointedCell()).toBe("shot-cell-1-1-3");
  });

  it("クリアしたマスへ他の端末が後から書いた後に戻すと、戻した点数で上書きする", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ initialShots: [shotRow(distanceA.id, 1, 1, "10", 10)] });
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-clear"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
    await act(() =>
      appendFromOtherPath({
        type: "shot.recorded",
        eventId: "e-other-tab",
        distanceId: distanceA.id,
        endNumber: 1,
        shotNumber: 1,
        scoreStr: "9",
        scoreInt: 9,
      }),
    );
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));

    // When
    await user.click(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    expect(screen.getByTestId("score-button-redo")).toBeEnabled();
  });
});

describe("ScorecardClient 距離の追加・編集・削除", () => {
  it("距離を追加を続けて2回押すと、2つとも足され、編集を開くのは最後に足した距離だけになる", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    const createdIds = () =>
      supabase.rpc.mock.calls
        .filter(([name]) => name === "create_distance")
        .map(([, args]) => (args as { p_id: string }).p_id);

    // When
    await user.dblClick(screen.getByTestId("add-distance-button"));

    // Then
    // 2回分の反映を待つ。
    await waitFor(
      () => {
        expect(screen.getAllByTestId(/^distance-summary-/)).toHaveLength(3);
        expect(createdIds()).toHaveLength(2);
      },
      { timeout: 5000 },
    );
    // 最後に足した距離のカードの番号を、行の属性(距離のID)から求める。
    const lastId = createdIds()[1];
    const card = document
      .querySelector(`[data-follow-row^="${lastId}:"]`)
      ?.closest("[data-distance-card]");
    const number = card
      ?.getAttribute("data-testid")
      ?.replace(/^distance-summary-/, "");
    expect(screen.getAllByTestId(/^distance-config-distance-/)).toHaveLength(1);
    expect(
      screen.getByTestId(`distance-config-distance-${number}`),
    ).toBeInTheDocument();
  });

  it("構成が変わる設定で距離を保存すると、その距離のUndo/Redo履歴だけが破棄され、他の距離の履歴は残る", async () => {
    // Given
    // 的はスコアが記録済みの距離では変更できないため、1つ目の距離は取り消して記録の無い状態にする。
    const user = userEvent.setup();
    await setup({ distances: [distanceA, distanceB] });
    await user.click(screen.getByTestId("shot-cell-2-1-1"));
    await user.click(screen.getByTestId("score-button-9"));
    await waitFor(() => expect(ballsOf(2, 1)).toEqual(["9"]));
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-undo"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
    expect(screen.getByTestId("score-button-undo")).toBeEnabled();
    expect(screen.getByTestId("score-button-redo")).toBeEnabled();

    // When
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("target-face-picker-trigger"));
    await chooseFilter(
      user,
      "target-face-format-select",
      roundsText("targetFaceFilterNone"),
    );
    await chooseFilter(
      user,
      "target-face-bow-type-select",
      roundsText("targetFaceFilterNone"),
    );
    await user.click(
      screen.getByTestId(`target-face-option-${targetFaceNoX.id}`),
    );
    await user.click(screen.getByTestId("distance-config-save-1"));

    // Then
    // 指している空のマスは新しい構成でも有効なため、テンキーは開いたまま。
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
    expect(screen.getByTestId("score-button-undo")).toBeEnabled();
  });

  it("構成が変わる保存の後に一つ戻ると、他の距離の記録が取り消される", async () => {
    // Given
    // 的はスコアが記録済みの距離では変更できないため、1つ目の距離は取り消して記録の無い状態にする。
    const user = userEvent.setup();
    await setup({ distances: [distanceA, distanceB] });
    await user.click(screen.getByTestId("shot-cell-2-1-1"));
    await user.click(screen.getByTestId("score-button-9"));
    await waitFor(() => expect(ballsOf(2, 1)).toEqual(["9"]));
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-undo"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("target-face-picker-trigger"));
    await chooseFilter(
      user,
      "target-face-format-select",
      roundsText("targetFaceFilterNone"),
    );
    await chooseFilter(
      user,
      "target-face-bow-type-select",
      roundsText("targetFaceFilterNone"),
    );
    await user.click(
      screen.getByTestId(`target-face-option-${targetFaceNoX.id}`),
    );
    await user.click(screen.getByTestId("distance-config-save-1"));

    // When
    await user.click(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(ballsOf(2, 1)).toEqual([]));
  });

  it("構成が変わらない設定で距離を保存すると、Undo/Redo履歴は維持される", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("score-button-10"));

    // When
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("distance-config-save-1"));

    // Then
    expect(screen.getByTestId("score-button-undo")).not.toBeDisabled();
  });

  it("距離編集パネルをEscapeで閉じると、保存せずパネルが閉じる", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    expect(
      screen.getByTestId("distance-config-distance-1"),
    ).toBeInTheDocument();

    // When
    await user.keyboard("{Escape}");

    // Then
    expect(
      screen.queryByTestId("distance-config-distance-1"),
    ).not.toBeInTheDocument();
    expect(await ackedStates()).toEqual([]);
    await flushMicrotasks();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("スコア記録済みの距離を確認の上で削除すると、その距離と記録が除かれ、指しているマスが無くなる", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ distances: [distanceA, distanceB] });
    await user.click(screen.getByTestId("score-button-10"));
    expect(
      screen.getByText(roundsText("roundTotal", { total: "10" })),
    ).toBeInTheDocument();

    // When
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("distance-config-delete-1"));
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    // Then
    expect(screen.queryByTestId("distance-summary-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("distance-summary-1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("confirm-dialog-confirm"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("distance-config-delete-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(roundsText("roundTotal", { total: "0" })),
    ).toBeInTheDocument();
    await waitFor(() => expect(pointedCell()).toBeNull());
  });

  it("スコア記録済みの距離を削除した後にマスを押してテンキーを開くと、一つ戻るを押せない", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ distances: [distanceA, distanceB] });
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("distance-config-delete-1"));
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    // When
    await user.click(screen.getByTestId("shot-cell-1-1-1"));

    // Then
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
  });

  it("指しているマスが無い距離を削除すると、その距離が無くなる", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ distances: [distanceA, distanceB] });

    // When
    await user.click(screen.getByTestId("distance-config-toggle-2"));
    await user.click(screen.getByTestId("distance-config-delete-2"));

    // Then
    expect(screen.queryByTestId("distance-summary-2")).not.toBeInTheDocument();
  });

  it("指しているマスが無い距離を削除した後に点数を書くと、指していた距離のエンドに記録される", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ distances: [distanceA, distanceB] });
    await user.click(screen.getByTestId("distance-config-toggle-2"));
    await user.click(screen.getByTestId("distance-config-delete-2"));

    // When
    await user.click(screen.getByTestId("score-button-10"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
  });
});

describe("ScorecardClient ヘッダー", () => {
  it("LeftPanelの外では、ドロワーのメニューを開くボタンは出ない", async () => {
    // Given
    // When
    await setup();

    // Then
    expect(
      screen.queryByRole("button", {
        name: translatorFor("navigation")("leftPanelOpenMenu"),
      }),
    ).toBeNull();
  });
});

describe("ScorecardClient プリセット保存の失敗", () => {
  async function confirmSave() {
    const user = userEvent.setup();
    await setup({ distances: [distanceA, distanceB] });
    await user.click(screen.getByTestId("save-as-preset-trigger"));
    await user.click(screen.getByTestId("save-as-preset-confirm"));
  }

  function savePresetCalls() {
    return supabase.rpc.mock.calls.filter(
      ([name]) => name === "save_round_as_preset",
    );
  }

  it("サーバーが保存を拒否したとき、サーバーの文言ではなく固定の文言を表示し、ダイアログを開いたままにする", async () => {
    // Given
    supabase.rpc.mockImplementation((name: string) =>
      name === "save_round_as_preset"
        ? Promise.resolve({
            data: null,
            error: { message: "保存に失敗しました。" },
            status: 403,
          })
        : rpcSucceeds(name),
    );

    // When
    await confirmSave();

    // Then
    expect(
      await screen.findByText(roundsText("presetSaveFailure.saveFailed")),
    ).toBeInTheDocument();
    expect(screen.queryByText("保存に失敗しました。")).not.toBeInTheDocument();
    expect(screen.getByTestId("save-as-preset-name")).toHaveValue(
      "テストラウンド",
    );
  });

  it("通信が届かなかったとき、固定の文言を表示し、ダイアログを開いたままにする", async () => {
    // Given
    supabase.rpc.mockImplementation((name: string) =>
      name === "save_round_as_preset"
        ? Promise.resolve({
            data: null,
            error: { message: "Failed to fetch" },
            status: 0,
          })
        : rpcSucceeds(name),
    );

    // When
    await confirmSave();

    // Then
    expect(
      await screen.findByText(roundsText("presetSaveFailure.saveFailed")),
    ).toBeInTheDocument();
    expect(screen.getByTestId("save-as-preset-name")).toBeInTheDocument();
  });

  it("サインインを確かめられないとき、手続きの文言を表示し、書き込まない", async () => {
    // Given
    supabase.getSession.mockResolvedValue({ data: { session: null } });

    // When
    await confirmSave();

    // Then
    expect(
      await screen.findByText(roundsText("fetchFailure.unauthenticated")),
    ).toBeInTheDocument();
    expect(screen.getByTestId("save-as-preset-name")).toBeInTheDocument();
    expect(savePresetCalls()).toEqual([]);
  });
});

describe("ScorecardClient ラウンド削除の後の遷移", () => {
  it("削除を確認すると、遷移元のホームへ置き換えて遷移し、履歴を積む遷移はしない", async () => {
    // Given
    const user = userEvent.setup();
    nav.push.mockClear();
    nav.replace.mockClear();
    await setup();
    await user.click(screen.getByTestId("round-menu-trigger"));
    await user.click(await screen.findByTestId("round-delete"));

    // When
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    // Then
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("disable_round", {
        p_round_event_id: expect.any(String),
        p_round_id: "round-1",
      });
    });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    expect(nav.replace).toHaveBeenCalledWith("/rounds");
    expect(nav.push).not.toHaveBeenCalled();
  });
});

// update_roundへ送られた状態の列。
function sentStatuses() {
  return supabase.rpc.mock.calls
    .filter(([name]) => name === "update_round")
    .map(([, args]) => args.p_changes.status);
}

describe("ScorecardClient ラウンドの完了", () => {
  const recorded = shotRow("distance-b", 1, 1, "10", 10);
  const allRecorded = fullEndShots(distanceB);

  it("全てのエンドが満杯になった入力中のラウンドで完了ボタンを押すと、確認なしで完了にし、ボタンを消して状態を送る", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ distances: [distanceB], initialShots: allRecorded });

    // When
    await user.click(screen.getByTestId("complete-round-button"));

    // Then
    await waitFor(() => expect(sentStatuses()).toEqual(["completed"]));
    expect(screen.queryByTestId("complete-round-button")).toBeNull();
    expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
  });

  it("1マスだけ空いているときは満杯でなく、完了ボタンを押すと確認を出す", async () => {
    // Given
    const user = userEvent.setup();
    await setup({
      distances: [distanceB],
      initialShots: allRecorded.slice(0, -1),
    });

    // When
    await user.click(screen.getByTestId("complete-round-button"));

    // Then
    expect(screen.getByTestId("confirm-dialog-confirm")).toBeInTheDocument();
    expect(sentStatuses()).toEqual([]);
  });

  it("満杯でないエンドがあるときは、確認でキャンセルすると入力中のままで何も送らない", async () => {
    // Given
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByTestId("complete-round-button"));

    // When
    await user.click(screen.getByTestId("confirm-dialog-cancel"));

    // Then
    expect(screen.getByTestId("complete-round-button")).toBeInTheDocument();
    expect(sentStatuses()).toEqual([]);
  });

  it("完了ボタンを押すと、完了の保存の後にホームへ移る", async () => {
    // Given
    const user = userEvent.setup();
    nav.push.mockClear();
    await setup({ distances: [distanceB], initialShots: allRecorded });

    // When
    await user.click(screen.getByTestId("complete-round-button"));

    // Then
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/rounds"));
  });

  it("完了ボタンを押した後、保存が終わる前に画面を離れると、ホームへ移らない", async () => {
    // Given
    nav.push.mockClear();
    const { unmount } = await setup({
      distances: [distanceB],
      initialShots: allRecorded,
    });

    // When
    // 同期に押して取り除く(userEventの待ちの間に保存が終わらないようにする)。
    fireEvent.click(screen.getByTestId("complete-round-button"));
    unmount();
    await waitFor(async () => expect(await ackedStates()).toEqual(["unacked"]));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Then
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("確認でキャンセルすると、ホームへ移らない", async () => {
    // Given
    const user = userEvent.setup();
    nav.push.mockClear();
    await setup();
    await user.click(screen.getByTestId("complete-round-button"));

    // When
    await user.click(screen.getByTestId("confirm-dialog-cancel"));

    // Then
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("距離が無いラウンドでは、記録がない旨の確認を出す", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ distances: [] });

    // When
    await user.click(screen.getByTestId("complete-round-button"));

    // Then
    expect(
      screen.getByText(roundsText("completionConfirmation.noRecords")),
    ).toBeInTheDocument();
  });

  it("完了のラウンドは、何も指さず、テンキーを展開しない", async () => {
    // Given

    // When
    await setup({ status: "completed" });

    // Then
    expect(screen.queryByTestId("score-button-10")).toBeNull();
    expect(pointedCell()).toBeNull();
    expect(screen.queryByTestId("complete-round-button")).toBeNull();
  });

  it("完了のラウンドは、距離が無くてもラウンド編集欄を自動で開かない", async () => {
    // Given

    // When
    await setup({ status: "completed", distances: [] });

    // Then
    expect(screen.queryByTestId("round-config-date")).toBeNull();
  });

  it("入力中のラウンドは、最初の空のマスを指してテンキーを展開する", async () => {
    // Given

    // When
    await setup();

    // Then
    expect(screen.getByTestId("score-button-10")).toBeInTheDocument();
  });

  it("完了のラウンドでエンドのマスを押して点数を記録すると、入力中へ戻して完了ボタンを再表示する", async () => {
    // Given
    const user = userEvent.setup();
    await setup({ status: "completed" });
    expect(screen.queryByTestId("complete-round-button")).toBeNull();
    await user.click(screen.getByTestId("shot-cell-1-1-1"));

    // When
    await user.click(screen.getByTestId("score-button-10"));

    // Then
    await waitFor(() => expect(sentStatuses()).toEqual(["in_progress"]));
    expect(screen.getByTestId("complete-round-button")).toBeInTheDocument();
  });

  it("完了のラウンドで記録済みのマスに同じ点数を書いても、入力中へ戻さない", async () => {
    // Given
    const user = userEvent.setup();
    await setup({
      status: "completed",
      distances: [distanceB],
      initialShots: [recorded],
    });
    await user.click(screen.getByTestId("shot-cell-1-1-1"));

    // When
    await user.click(screen.getByTestId("score-button-10"));

    // Then
    await waitFor(() => expect(sentShots("record_shots")).toHaveLength(1));
    expect(sentStatuses()).toEqual([]);
    expect(screen.queryByTestId("complete-round-button")).toBeNull();
  });
});

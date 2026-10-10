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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalIdentity } from "@/features/auth/local-identity";
import { retryDelayMs } from "@/features/op-log/sync-result";
import { roundOpHub } from "../_shared/round-op-hub";
import { roundOpLog } from "../_shared/round-op-log";
import { roundOpStore } from "../_shared/round-op-store";
import type { TargetFaceOption } from "./distance-config-row";
import type { RoundConfig } from "./round-config";
import { roundTablesFromServer } from "./round-tables";
import { ScorecardClient } from "./scorecard-client";
import type { Distance, Shot } from "./scorecard-types";

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
    auth: { getSession: supabase.getSession },
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
async function pollWithRealTasks(assertion: () => void, maxTasks = 200) {
  let lastError: unknown;
  for (let i = 0; i < maxTasks; i += 1) {
    await flushMicrotasks();
    try {
      assertion();
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
  total_ends: 2,
  arrows_per_end: 2,
  target_face_id: targetFaceX.id,
  is_marked: true,
};

const distanceB = {
  id: "distance-b",
  position_key: "b",
  distance: 50,
  total_ends: 1,
  arrows_per_end: 1,
  target_face_id: targetFaceX.id,
  is_marked: true,
};

const roundConfig: RoundConfig = {
  name: "テストラウンド",
  roundDate: "2026-09-15",
  format: "outdoor",
  bowType: "recurve",
};

function setup(
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
  return render(
    <ScorecardClient
      roundId="round-1"
      loaded={{
        base: roundTablesFromServer({
          status,
          roundConfig: initialRoundConfig,
          distances,
          shots: initialShots,
        }),
        group: { base: undefined, entries: [] },
        source: "server",
      }}
      targetFaces={faces}
    />,
  );
}

// 取得した矢の行。
function shotRow(
  id: string,
  distanceId: string,
  end: number,
  scoreStr: string,
  scoreInt: number,
): Shot {
  return {
    id,
    distance_id: distanceId,
    end_number: end,
    shooter_id: "user-1",
    score_str: scoreStr,
    score_int: scoreInt,
    shot_number: null,
  };
}

// エンドの記録済みの玉の点数を、表示の順に返す。
function ballsOf(distanceNumber: number, end: number): string[] {
  return within(screen.getByTestId(`end-row-${distanceNumber}-${end}`))
    .queryAllByTestId(/^shot-ball-/)
    .map((ball) => ball.textContent ?? "");
}

// 仮の矢を表示しているエンド。表示していなければnull。
function provisionalEnd(): string | null {
  const provisional = screen.queryAllByTestId("provisional-shot");
  expect(provisional.length).toBeLessThanOrEqual(1);
  return (
    provisional[0]
      ?.closest("[data-testid^='end-row-']")
      ?.getAttribute("data-testid") ?? null
  );
}

// 効いた操作の判定結果。
const APPLIED = {
  revision: 2,
  applied: true,
  applied_fields: null,
  rejected_fields: [],
  reason: null,
};

// RPCの成功は、判定結果を返す。マスの操作は、渡した件数分の配列を返す。ラウンドの削除だけは、revisionの数値を返す。
function rpcSucceeds(name: string, args?: { p_shots?: unknown[] }) {
  let data: unknown = APPLIED;
  if (args?.p_shots) data = args.p_shots.map(() => APPLIED);
  if (name === "disable_round") data = 2;
  return Promise.resolve({ data, error: null });
}

beforeEach(async () => {
  vi.clearAllMocks();
  // IndexedDBはfake-indexeddbで代替し、テストごとに空のDBから始める。常駐の送信が前のテストのDBを読まないよう、接続を閉じてから替える。
  await roundOpStore.close();
  globalThis.indexedDB = new IDBFactory();
  setOnline(true);
  // アプリでは、ルートレイアウトのOpSyncProviderがハブを起動する。
  roundOpHub.start(getLocalIdentity());
  // 起動時の全列の読み込み(DBの初回の作成を含む)がテストの操作と重ならないよう、完了を待つ。同じDBへの読み込みは起動時の読み込みより後に完了する。
  await roundOpStore.loadAll(getLocalIdentity());
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

afterEach(async () => {
  vi.useRealTimers();
  setOnline(true);
  // 操作の列はアンマウント後も送信を続けるため、送信中の操作が次のテストのスタブに届かないよう、マウント中に送信を終わらせる。
  // オフラインで保留中の操作はonlineイベントで再開させ、全ての操作が確定済みか保留の最終状態になるまで待つ。
  // Testing Libraryのcleanup（アンマウント）より先に実行される。
  try {
    const sender = roundOpLog.round("round-1");
    act(() => {
      roundOpHub.handleOnline();
    });
    await waitFor(() => {
      for (const item of sender.getSnapshot().items) {
        expect(["acked", "held"]).toContain(item.status);
      }
    });
  } finally {
    roundOpHub.stop();
  }
});

describe("ScorecardClient 初期表示・集計", () => {
  it("スコアを入力すると、エンド小計・距離の集計・ラウンド全体の集計に反映される", async () => {
    // Given: Xのある的の距離が1つあり、記録が無い
    const user = userEvent.setup();
    setup();

    // When: 1エンド目に10とXを入力する
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-X"));

    // Then: 1エンド目だけに小計が表示され、距離とラウンド全体の合計・最高点数/X数が表示される
    await waitFor(() =>
      expect(screen.getByTestId("end-subtotal-1-1")).toHaveTextContent("20"),
    );
    expect(screen.getByTestId("end-subtotal-1-2")).toHaveTextContent("");
    expect(screen.getByTestId("distance-summary-1")).toHaveTextContent(
      "小計20",
    );
    expect(screen.getByTestId("distance-top-scores-1")).toHaveTextContent(
      "10: 2 / X: 1",
    );
    expect(screen.getByTestId("round-top-scores")).toHaveTextContent(
      "10: 2 / X: 1",
    );
    expect(screen.getByText("合計20")).toBeInTheDocument();
  });

  it("Xの無い的では、スコアを入力すると、小計・合計・最高点数と次点数が距離とラウンド全体に反映される", async () => {
    // Given: Xの無い的の距離が1つあり、記録が無い
    const user = userEvent.setup();
    setup({ distances: [{ ...distanceA, target_face_id: targetFaceNoX.id }] });

    // When: 1エンド目に6と5を入力する
    await user.click(screen.getByTestId("score-button-6"));
    await user.click(screen.getByTestId("score-button-5"));

    // Then: エンド小計・距離の小計・ラウンド全体の合計が更新され、距離とラウンド全体に最高点数と次点数を表示する
    expect(screen.getByTestId("end-subtotal-1-1")).toHaveTextContent("11");
    expect(screen.getByTestId("distance-summary-1")).toHaveTextContent(
      "小計11",
    );
    expect(screen.getByTestId("distance-top-scores-1")).toHaveTextContent(
      "6: 1 / 5: 1",
    );
    expect(screen.getByTestId("round-top-scores")).toHaveTextContent(
      "6: 1 / 5: 1",
    );
    expect(screen.getByText("合計11")).toBeInTheDocument();
  });

  it("距離間で的の点数構成が異なる場合、ラウンド全体の最高点数などは表示せず、距離ごとには表示する", () => {
    // Given: Xのある的とXの無い的の距離があり、Xの無い的の距離に記録がある
    setup({
      distances: [
        distanceA,
        { ...distanceB, target_face_id: targetFaceNoX.id },
      ],
      initialShots: [shotRow("s-b", distanceB.id, 1, "5", 5)],
    });

    // When: 表示する（初期表示）
    // Then: ラウンド全体の最高点数などは表示せず、距離ごとの最高点数などと合計は表示する
    expect(screen.queryByTestId("round-top-scores")).not.toBeInTheDocument();
    expect(screen.getByTestId("distance-top-scores-2")).toHaveTextContent(
      "6: 0 / 5: 1",
    );
    expect(screen.getByText("合計5")).toBeInTheDocument();
  });

  it("距離の的で最高点数などを集計できない場合、その距離の最高点数などは表示しない", () => {
    // Given: リングの無い的の距離
    const targetFaceBlank: TargetFaceOption = {
      id: "face-blank",
      name: "未設定の的",
      size: 40,
      format: "outdoor",
      bow_type: ["recurve"],
      target_face_spots: [],
    };
    setup({
      distances: [{ ...distanceA, target_face_id: targetFaceBlank.id }],
      targetFaces: [targetFaceBlank],
    });

    // When: 表示する（初期表示）
    // Then: その距離の最高点数などは表示しない
    expect(
      screen.queryByTestId("distance-top-scores-1"),
    ).not.toBeInTheDocument();
  });

  describe("的の表示", () => {
    const shotOnA = shotRow("s-a", distanceA.id, 1, "9", 9);

    it("的の一覧が空で取得が完了している場合は、「的データを取得できません」を表示し、距離・本数・エンド数と記録済みの点数は維持する", () => {
      setup({ targetFaces: [], initialShots: [shotOnA] });

      const row = screen.getByTestId("distance-config-toggle-1");
      expect(row).toHaveTextContent("的データを取得できません");
      expect(row).toHaveTextContent("70m");
      expect(row).toHaveTextContent("2本×2エンド");
      expect(screen.getByTestId("shot-ball-1-1-1")).toHaveTextContent("9");
    });

    it("的の一覧に距離の的があれば、サイズを表示する", () => {
      setup();

      expect(screen.getByTestId("distance-config-toggle-1")).toHaveTextContent(
        `${targetFaceX.size}cm`,
      );
    });
  });

  it("距離が1件も無い場合は追加ボタンのみを表示する", () => {
    setup({ distances: [] });

    expect(screen.queryByTestId("round-top-scores")).not.toBeInTheDocument();
    expect(screen.queryByTestId("distance-summary-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("add-distance-button")).toBeInTheDocument();
  });

  it("全てのエンドが矢数に達している場合、マウント時に何も指さず、テンキーも空白も出さない", () => {
    // Given: 距離の全てのエンドが矢数に達している
    setup({
      initialShots: [
        shotRow("s-1", distanceA.id, 1, "10", 10),
        shotRow("s-2", distanceA.id, 1, "9", 9),
        shotRow("s-3", distanceA.id, 2, "X", 10),
        shotRow("s-4", distanceA.id, 2, "9", 9),
      ],
    });

    // When: 表示する（初期表示）
    // Then: テンキーと仮の矢は出ず、満杯のエンドには空白が無い
    expect(screen.queryByTestId("score-button-10")).not.toBeInTheDocument();
    expect(provisionalEnd()).toBeNull();
    expect(screen.queryByTestId("end-blank-1-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("end-blank-1-2")).not.toBeInTheDocument();
  });

  it("記録済みの玉は、リングの色相・彩度のまま明度を上げた背景色と黒の文字色で表示する", () => {
    // Given: 赤と白のリングを持つ的の距離に、それぞれのリングの記録がある
    const targetFaceRedWhite: TargetFaceOption = {
      id: "face-red-white",
      name: "赤白の的",
      size: 122,
      format: "outdoor",
      bow_type: ["recurve"],
      target_face_spots: [
        {
          center_x: 0,
          center_y: 0,
          target_face_rings: [
            {
              radius: 1,
              color: "#F65058",
              line_color: null,
              z_index: 2,
              score_str: "8",
              score_int: 8,
            },
            {
              radius: 2,
              color: "#FFFFFF",
              line_color: "#231F20",
              z_index: 1,
              score_str: "2",
              score_int: 2,
            },
          ],
        },
      ],
    };
    setup({
      distances: [{ ...distanceA, target_face_id: targetFaceRedWhite.id }],
      targetFaces: [targetFaceRedWhite],
      initialShots: [
        shotRow("s-2", distanceA.id, 1, "2", 2),
        shotRow("s-8", distanceA.id, 1, "8", 8),
      ],
    });

    // When: 表示する（初期表示）
    // Then: 点数の高い順に並び、赤は薄い赤、無彩色の白は薄い灰色の背景になり、文字色はいずれも黒になる
    const disc = (testId: string) =>
      screen.getByTestId(testId).querySelector("span");
    expect(disc("shot-ball-1-1-1")).toHaveTextContent("8");
    expect(disc("shot-ball-1-1-1")).toHaveStyle({
      backgroundColor: "#FDCED1",
      color: "#231F20",
    });
    expect(disc("shot-ball-1-1-2")).toHaveStyle({
      backgroundColor: "#E6E6E6",
      color: "#231F20",
    });
  });

  it("テンキーの閉じるボタンで何も指さなくすると、格納中のテンキーへの入力は無視される", async () => {
    // Given: エンド1の新しい矢を指している
    const user = userEvent.setup();
    setup();

    // When: テンキーを閉じ、格納が終わる前に点数を押す
    await user.click(screen.getByTestId("keypad-toggle"));
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 矢は記録されず、仮の矢も消え、SDKへも送られない
    expect(ballsOf(1, 1)).toEqual([]);
    expect(provisionalEnd()).toBeNull();
    await flushMicrotasks();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("距離が無いラウンド（カスタム開始直後）は、ラウンド構成が展開された状態で表示する", () => {
    // Given: 距離が0件のラウンド
    // When: 表示する（初期表示）
    setup({ distances: [] });

    // Then: ラウンド構成の編集欄が展開されている
    expect(screen.getByTestId("round-config-name")).toBeInTheDocument();
  });

  it("距離があるラウンド（プリセット開始など）は、ラウンド構成が折りたたまれた状態で表示する", () => {
    // Given: 距離が1件以上あるラウンド
    // When: 表示する（初期表示）
    setup();

    // Then: ラウンド構成の編集欄は表示されない
    expect(screen.queryByTestId("round-config-name")).not.toBeInTheDocument();
  });
});

// 操作の列がSDKへ送った矢の操作を、呼び出しをまたいで順に並べる。
function sentShots(rpcName: "record_shots" | "clear_shots") {
  return supabase.rpc.mock.calls
    .filter(([name]) => name === rpcName)
    .flatMap(([, args]) => args.p_shots);
}

describe("ScorecardClient 矢を指す・点数を書く", () => {
  // 入力中で矢数に達していないエンドがあるラウンドは、マウント時点で最初のエンドの新しい矢を指し、テンキーが開いている。

  it("開いた直後は、矢数に達していない最初のエンドに仮の矢を出す", () => {
    // Given: エンド1が満杯
    setup({
      initialShots: [
        shotRow("s-1", distanceA.id, 1, "10", 10),
        shotRow("s-2", distanceA.id, 1, "9", 9),
      ],
    });

    // When: 表示する（初期表示）
    // Then
    expect(provisionalEnd()).toBe("end-row-1-2");
  });

  it("新しい矢に点数を書くと、端末が作ったIDの矢を射手・射順なしで記録し、同じエンドの新しい矢を指したままにする", async () => {
    // Given: エンド1の新しい矢を指している
    const user = userEvent.setup();
    setup();

    // When: 10を押す
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 記録した玉の後ろに仮の矢が出て、新しいIDの矢がSDKへ届く
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    expect(provisionalEnd()).toBe("end-row-1-1");
    await waitFor(() => {
      expect(sentShots("record_shots")).toEqual([
        {
          shot_event_id: expect.any(String),
          shot_id: expect.any(String),
          distance_id: distanceA.id,
          end_number: 1,
          score_str: "10",
          score_int: 10,
        },
      ]);
    });
    const [sent] = sentShots("record_shots");
    expect(sent.shot_id).not.toBe(sent.shot_event_id);
  });

  it("入力の順によらず、記録済みの玉を点数の高い順に並べる", async () => {
    // Given: 矢数6のエンドの新しい矢を指している
    const user = userEvent.setup();
    setup({ distances: [{ ...distanceA, arrows_per_end: 6 }] });

    // When: 7、10、X、9、M、9の順に押す
    for (const key of ["9", "M", "X", "10", "9"]) {
      await user.click(screen.getByTestId(`score-button-${key}`));
    }

    // Then
    await waitFor(() =>
      expect(ballsOf(1, 1)).toEqual(["X", "10", "9", "9", "M"]),
    );
    expect(screen.getByTestId("end-subtotal-1-1")).toHaveTextContent("38");
  });

  it("エンドが矢数に達すると同じ距離の次のエンドへ進み、距離の最後では何も指さずテンキーを格納する", async () => {
    // Given: 2エンド×2本の距離と、1エンド×1本の距離
    const user = userEvent.setup();
    setup({ distances: [distanceA, distanceB] });

    // When: 4本を書く
    for (const key of ["10", "9", "X", "9"]) {
      await user.click(screen.getByTestId(`score-button-${key}`));
    }

    // Then: 次の距離へはまたがず、テンキーを格納する
    await waitFor(() => expect(ballsOf(1, 2)).toEqual(["X", "9"]));
    expect(ballsOf(1, 1)).toEqual(["10", "9"]);
    expect(provisionalEnd()).toBeNull();
    await waitFor(() => {
      expect(screen.queryByTestId("score-button-10")).not.toBeInTheDocument();
    });
  });

  it("画面へ反映される前に続けて押しても、エンドの矢数を超えて書かない", async () => {
    // Given: 2本のエンド1の新しい矢を指している
    setup();

    // When: 保存の完了を待たずに3回押す
    fireEvent.click(screen.getByTestId("score-button-10"));
    fireEvent.click(screen.getByTestId("score-button-9"));
    fireEvent.click(screen.getByTestId("score-button-X"));

    // Then: 3本目は次のエンドへ記録する
    await waitFor(() => expect(ballsOf(1, 2)).toEqual(["X"]));
    expect(ballsOf(1, 1)).toEqual(["10", "9"]);
  });

  it("記録済みの玉を押すとその矢を指し、点数を書くとその矢だけを直して指したままにする", async () => {
    // Given: 10と9の矢がある
    const user = userEvent.setup();
    setup({
      initialShots: [
        shotRow("s-10", distanceA.id, 1, "10", 10),
        shotRow("s-9", distanceA.id, 1, "9", 9),
      ],
    });

    // When: 9の玉を押し、Xを書く
    await user.click(screen.getByTestId("shot-ball-1-1-2"));
    expect(screen.getByTestId("shot-ball-1-1-2")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(provisionalEnd()).toBeNull();
    await user.click(screen.getByTestId("score-button-X"));

    // Then: 直した矢が先頭へ並び直り、指したままで、同じIDの矢の記録がSDKへ届く
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["X", "10"]));
    expect(screen.getByTestId("shot-ball-1-1-1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("shot-ball-1-1-2")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await waitFor(() => {
      expect(sentShots("record_shots")).toEqual([
        expect.objectContaining({ shot_id: "s-9", score_str: "X" }),
      ]);
    });
    expect(sentShots("record_shots")[0]).not.toHaveProperty("shooter_id");
  });

  it("クリアは記録済みの矢を指しているときだけ使え、その矢を消してそのエンドの新しい矢を指す", async () => {
    // Given: 10と9の矢があり、エンド2の新しい矢を指している
    const user = userEvent.setup();
    setup({
      initialShots: [
        shotRow("s-10", distanceA.id, 1, "10", 10),
        shotRow("s-9", distanceA.id, 1, "9", 9),
      ],
    });
    expect(screen.getByTestId("score-button-clear")).toBeDisabled();

    // When: 10の玉を押してクリアする
    await user.click(screen.getByTestId("shot-ball-1-1-1"));
    expect(screen.getByTestId("score-button-clear")).toBeEnabled();
    await user.click(screen.getByTestId("score-button-clear"));

    // Then: その矢だけが消え、エンド1の新しい矢を指し、クリアがSDKへ届く
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));
    expect(provisionalEnd()).toBe("end-row-1-1");
    expect(screen.getByTestId("score-button-clear")).toBeDisabled();
    await waitFor(() => {
      expect(sentShots("clear_shots")).toEqual([
        {
          shot_event_id: expect.any(String),
          shot_id: "s-10",
          distance_id: distanceA.id,
        },
      ]);
    });
  });

  it("エンドの空白を押すとそのエンドの新しい矢を指し、次の点数はそのエンドに記録する", async () => {
    // Given: エンド1の新しい矢を指している
    const user = userEvent.setup();
    setup();

    // When: エンド2の空白を押して9を書く
    await user.click(screen.getByTestId("end-blank-1-2"));
    expect(provisionalEnd()).toBe("end-row-1-2");
    await user.click(screen.getByTestId("score-button-9"));

    // Then
    await waitFor(() => expect(ballsOf(1, 2)).toEqual(["9"]));
    expect(ballsOf(1, 1)).toEqual([]);
  });

  it("2つ目以降の空白を押しても、そのエンドの新しい矢を指し、仮の矢は最初の空白に出す", async () => {
    // Given: 矢数3の距離で、エンド1の新しい矢を指している
    const user = userEvent.setup();
    setup({ distances: [{ ...distanceA, arrows_per_end: 3 }] });

    // When: エンド2の3つ目の場所(空白)を押す
    await user.click(screen.getByTestId("end-slot-1-2-3"));

    // Then
    expect(provisionalEnd()).toBe("end-row-1-2");
    expect(
      within(screen.getByTestId("end-blank-1-2")).getByTestId(
        "provisional-shot",
      ),
    ).toBeInTheDocument();
  });

  it("空白には、押せる場所だと分かる読み上げの名前を付け、玉には付けない", () => {
    setup({ initialShots: [shotRow("s-1", distanceA.id, 1, "10", 10)] });

    expect(screen.getByTestId("end-blank-1-2")).toHaveAccessibleName(
      "エンド2に追加",
    );
    expect(screen.getByTestId("shot-ball-1-1-1")).not.toHaveAttribute(
      "aria-label",
    );
    expect(screen.getByTestId("shot-ball-1-1-1")).toHaveAccessibleName("10");
  });

  it("2つ目以降の空白は、読み上げとTabの移動から外す", () => {
    // Given/When: 矢数3の距離で、エンド1に1本記録済み
    setup({
      distances: [{ ...distanceA, arrows_per_end: 3 }],
      initialShots: [shotRow("s-1", distanceA.id, 1, "10", 10)],
    });

    // Then
    const slot = screen.getByTestId("end-slot-1-1-3");
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(slot).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByTestId("end-slot-1-1-2")).not.toBeInTheDocument();
  });

  it("番号や小計を押しても、指している矢は変わらない", async () => {
    // Given: エンド1の新しい矢を指している
    const user = userEvent.setup();
    setup();

    // When: エンド2の番号と小計を押す
    await user.click(screen.getByTestId("end-subtotal-1-2"));
    await user.click(within(screen.getByTestId("end-row-1-2")).getByText("2"));

    // Then
    expect(provisionalEnd()).toBe("end-row-1-1");
  });

  it("テンキーは距離の的のリング色と、その色に応じた文字色で表示する", () => {
    // Given: Xの無い的の距離の新しい矢を指している
    setup({ distances: [{ ...distanceA, target_face_id: targetFaceNoX.id }] });

    // When: 表示する（初期表示）
    // Then: 暗いリング色のキーは白文字、Mは固定の背景色と黒文字で表示される
    expect(screen.getByTestId("score-button-5")).toHaveStyle({
      backgroundColor: "#0066B3",
      color: "#FFFFFF",
    });
    expect(screen.getByTestId("score-button-M")).toHaveStyle({
      backgroundColor: "#4CD964",
      color: "#231F20",
    });
  });

  it("別の距離のエンドの空白を押すと、その距離の的のキーに切り替わる", async () => {
    // Given: Xのある的の距離とXの無い的の距離
    const user = userEvent.setup();
    setup({
      distances: [
        distanceA,
        { ...distanceB, target_face_id: targetFaceNoX.id },
      ],
    });
    expect(screen.getByTestId("score-button-X")).toBeInTheDocument();

    // When
    await user.click(screen.getByTestId("end-blank-2-1"));

    // Then
    expect(screen.queryByTestId("score-button-X")).not.toBeInTheDocument();
    expect(screen.getByTestId("score-button-6")).toBeInTheDocument();
  });

  it("複数スポットの的では、テンキーに点数のキーを重複なく、リング色で表示する", () => {
    // Given: 同じ点数を持つ2つのスポットがある的の距離
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

    // When: 表示する（初期表示）
    setup({
      distances: [{ ...distanceA, target_face_id: targetFaceTriple.id }],
      targetFaces: [targetFaceTriple],
    });

    // Then: スポットの数によらず、点数ごとに1つのキーがリング色で表示される
    expect(screen.getAllByTestId("score-button-10")).toHaveLength(1);
    expect(screen.getAllByTestId("score-button-9")).toHaveLength(1);
    expect(screen.getByTestId("score-button-9")).toHaveStyle({
      backgroundColor: "#0066B3",
    });
    expect(screen.getByTestId("score-button-M")).toBeInTheDocument();
  });
});

describe("ScorecardClient 並び直りの動き", () => {
  // jsdomはレイアウトを計算しないため、玉の位置を親の中の順番から与える。
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(
      function (this: HTMLElement) {
        return [...(this.parentElement?.children ?? [])].indexOf(this) * 36;
      },
    );
    HTMLElement.prototype.animate = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });

  async function rewriteNineToX() {
    const user = userEvent.setup();
    setup({
      initialShots: [
        shotRow("s-10", distanceA.id, 1, "10", 10),
        shotRow("s-9", distanceA.id, 1, "9", 9),
      ],
    });
    await user.click(screen.getByTestId("shot-ball-1-1-2"));
    await user.click(screen.getByTestId("score-button-X"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["X", "10"]));
  }

  it("書いた矢が並び直ると、前の位置から今の位置へ200msで動かす", async () => {
    // Given/When: 9の矢をXへ直し、先頭へ並び直る
    await rewriteNineToX();

    // Then: 直した矢と押し出された矢が動く
    const animate = vi.mocked(HTMLElement.prototype.animate);
    const moved = animate.mock.contexts.map((element) =>
      (element as HTMLElement).getAttribute("data-shot-id"),
    );
    expect(moved.sort()).toEqual(["s-10", "s-9"]);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translate(36px, 0px)" }, { transform: "translate(0, 0)" }],
      { duration: 200, easing: "ease-out" },
    );
  });

  it("同点の矢を足すと、既にある同点の玉を動かさず、新しい玉をその後ろに出す", async () => {
    // Given: 先頭の大きいUUID(移行で付けたような無作為のID)の9の矢があるエンド
    const user = userEvent.setup();
    const existing = "ffffffff-fff0-4fff-bfff-ffffffffffff";
    setup({ initialShots: [shotRow(existing, distanceA.id, 1, "9", 9)] });

    // When: エンドの空白を押し、9を書く
    await user.click(screen.getByTestId("end-blank-1-1"));
    await user.click(screen.getByTestId("score-button-9"));

    // Then: 既存の9の玉は動かず、新しい9の玉が後ろに並ぶ
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9", "9"]));
    const ids = within(screen.getByTestId("end-row-1-1"))
      .getAllByTestId(/^shot-ball-/)
      .map((ball) => ball.getAttribute("data-shot-id"));
    expect(ids[0]).toBe(existing);
    const moved = vi
      .mocked(HTMLElement.prototype.animate)
      .mock.contexts.map((element) =>
        (element as HTMLElement).getAttribute("data-shot-id"),
      );
    expect(moved).not.toContain(existing);
  });

  it("動きを減らす設定では動かさない", async () => {
    // Given: 動きを減らす設定
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    // When
    await rewriteNineToX();

    // Then
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  });

  it("玉の領域の幅が前の描画から変わったときは動かさない", async () => {
    // Given: 描画のたびに玉の領域の幅が変わる(回転や窓の大きさの変更)
    let width = 100;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => {
        width += 1;
        return width;
      },
    );

    // When
    await rewriteNineToX();

    // Then
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  });
  it("玉の領域の列の数が前の描画から変わったときは動かさない", () => {
    // Given: 幅を測る前は1段、測った後は3列2段に変わる。親のclientWidthは固定のまま、玉の縦位置は列の数から決まる
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
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(108);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        const columns = Number(
          /repeat\((\d+)/.exec(
            this.parentElement?.style.gridTemplateColumns ?? "",
          )?.[1] ?? 1,
        );
        const index = [...(this.parentElement?.children ?? [])].indexOf(this);
        return Math.floor(index / columns) * 40;
      },
    );

    // When: 矢数6の距離を、4本記録済みのまま開く
    setup({
      distances: [{ ...distanceA, arrows_per_end: 6 }],
      initialShots: [
        shotRow("s-1", distanceA.id, 1, "10", 10),
        shotRow("s-2", distanceA.id, 1, "9", 9),
        shotRow("s-3", distanceA.id, 1, "8", 8),
        shotRow("s-4", distanceA.id, 1, "7", 7),
      ],
    });

    // Then: 4本目は幅を測る前後で段が変わるが、動かさない
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  });

  describe("仮の矢", () => {
    // 仮の矢に呼んだ動きのキーフレーム。
    function provisionalMoves() {
      const animate = vi.mocked(HTMLElement.prototype.animate);
      return animate.mock.calls.filter(
        (_, i) =>
          (animate.mock.contexts[i] as HTMLElement).getAttribute(
            "data-testid",
          ) === "provisional-shot",
      );
    }

    // 指定した矢数の距離のエンド1に10, 9, 8を記録し、先頭の10を指してクリアする。
    async function clearFirstOf3(arrows: number) {
      const user = userEvent.setup();
      setup({
        distances: [{ ...distanceA, arrows_per_end: arrows }],
        initialShots: [
          shotRow("s-10", distanceA.id, 1, "10", 10),
          shotRow("s-9", distanceA.id, 1, "9", 9),
          shotRow("s-8", distanceA.id, 1, "8", 8),
        ],
      });
      await user.click(screen.getByTestId("shot-ball-1-1-1"));
      await user.click(screen.getByTestId("score-button-clear"));
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9", "8"]));
    }

    it("クリアすると、後ろの玉と仮の矢を動かし、仮の矢は消した玉の位置から最初の空白へ動く", async () => {
      // Given/When: 矢数6のエンドで、先頭の10を指してクリアする
      await clearFirstOf3(6);

      // Then: 詰まる玉と仮の矢が動き、仮の矢は消した玉の位置(0)から最初の空白(72)へ動く
      const moved = vi
        .mocked(HTMLElement.prototype.animate)
        .mock.contexts.map(
          (element) =>
            (element as HTMLElement).getAttribute("data-shot-id") ??
            (element as HTMLElement).getAttribute("data-testid"),
        );
      expect(moved.sort()).toEqual(["provisional-shot", "s-8", "s-9"]);
      expect(provisionalMoves()).toEqual([
        [
          [
            { transform: "translate(-72px, 0px)" },
            { transform: "translate(0, 0)" },
          ],
          { duration: 200, easing: "ease-out" },
        ],
      ]);
    });

    it("満杯のエンドでクリアしても、仮の矢は消した玉の位置から最初の空白へ動く", async () => {
      // Given/When: 矢数3の満杯のエンドで、先頭の10を指してクリアする
      await clearFirstOf3(3);

      // Then
      expect(provisionalMoves()).toEqual([
        [
          [
            { transform: "translate(-72px, 0px)" },
            { transform: "translate(0, 0)" },
          ],
          { duration: 200, easing: "ease-out" },
        ],
      ]);
    });

    it("記録済みの玉を指しているときに同じエンドの空白を押すと、仮の矢を動かさない", async () => {
      // Given: 矢数6のエンドで、記録済みの10を指している
      const user = userEvent.setup();
      setup({
        distances: [{ ...distanceA, arrows_per_end: 6 }],
        initialShots: [shotRow("s-10", distanceA.id, 1, "10", 10)],
      });
      await user.click(screen.getByTestId("shot-ball-1-1-1"));

      // When: 同じエンドの空白を押す
      await user.click(screen.getByTestId("end-blank-1-1"));

      // Then: 仮の矢は出るが、玉が残っているため動かさない
      expect(provisionalEnd()).toBe("end-row-1-1");
      expect(provisionalMoves()).toEqual([]);
    });

    it("新しい矢に書くと、仮の矢が次の空白へ動く", async () => {
      // Given: 矢数6のエンドに10があり、新しい矢を指している
      const user = userEvent.setup();
      setup({
        distances: [{ ...distanceA, arrows_per_end: 6 }],
        initialShots: [shotRow("s-10", distanceA.id, 1, "10", 10)],
      });
      expect(provisionalEnd()).toBe("end-row-1-1");

      // When: 9を書く
      await user.click(screen.getByTestId("score-button-9"));

      // Then: 仮の矢が2番目(36)から3番目(72)の空白へ動く
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10", "9"]));
      expect(provisionalMoves()).toEqual([
        [
          [
            { transform: "translate(-36px, 0px)" },
            { transform: "translate(0, 0)" },
          ],
          { duration: 200, easing: "ease-out" },
        ],
      ]);
    });

    it("動きを減らす設定でクリアすると、玉も仮の矢も動かさない", async () => {
      // Given: 動きを減らす設定
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) =>
          ({
            matches: query === "(prefers-reduced-motion: reduce)",
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      );

      // When
      await clearFirstOf3(6);

      // Then
      expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
    });
  });

  describe("動いている途中の反映", () => {
    // 動きの途中の変形。動いている要素の見た目の位置は、レイアウト上の位置からこれだけずれている。
    const OFFSET = { x: 10, y: 5 };
    type FakeAnimation = { playState: string; cancel: () => void };
    let running: Map<Element, FakeAnimation>;

    // animateは止めるまで動き続ける動きを返し、見た目の位置は動いている間だけ途中の変形の分ずれる。
    beforeEach(() => {
      running = new Map();
      vi.mocked(HTMLElement.prototype.animate).mockImplementation(function (
        this: HTMLElement,
      ) {
        const animation: FakeAnimation = {
          playState: "running",
          cancel: vi.fn(() => {
            animation.playState = "idle";
          }),
        };
        running.set(this, animation);
        return animation as unknown as Animation;
      });
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
        function (this: Element) {
          const moving = running.get(this)?.playState === "running";
          return {
            left: moving ? OFFSET.x : 0,
            top: moving ? OFFSET.y : 0,
          } as DOMRect;
        },
      );
    });

    // 動きのキーフレームの始点。
    function startsOf(testIdOrShotId: string) {
      const animate = vi.mocked(HTMLElement.prototype.animate);
      return animate.mock.calls
        .filter((_, i) => {
          const element = animate.mock.contexts[i] as HTMLElement;
          return (
            (element.getAttribute("data-shot-id") ??
              element.getAttribute("data-testid")) === testIdOrShotId
          );
        })
        .map(([keyframes]) => (keyframes as Keyframe[])[0]?.transform);
    }

    function cancelled() {
      return [...running.values()].filter(
        (animation) => vi.mocked(animation.cancel).mock.calls.length > 0,
      ).length;
    }

    it("並び直りの途中で次の反映が来ると、途中の見た目の位置から動かし直す", async () => {
      // Given: 9をXへ直し、2つの玉が動いている途中
      const user = userEvent.setup();
      await rewriteNineToX();

      // When: 先頭へ動いたXを9へ戻す
      await user.click(screen.getByTestId("shot-ball-1-1-1"));
      await user.click(screen.getByTestId("score-button-9"));
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10", "9"]));

      // Then: 2回目の始点は、レイアウト上の差に途中の変形を足した位置になる
      expect(startsOf("s-9")).toEqual([
        "translate(36px, 0px)",
        "translate(-26px, 5px)",
      ]);
      expect(startsOf("s-10")).toEqual([
        "translate(-36px, 0px)",
        "translate(46px, 5px)",
      ]);
    });

    it("仮の矢が動いている途中で次の反映が来ると、途中の見た目の位置から動かし直す", async () => {
      // Given: 矢数6のエンドに10があり、9を書いて仮の矢が動いている途中
      const user = userEvent.setup();
      setup({
        distances: [{ ...distanceA, arrows_per_end: 6 }],
        initialShots: [shotRow("s-10", distanceA.id, 1, "10", 10)],
      });
      await user.click(screen.getByTestId("score-button-9"));
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10", "9"]));

      // When: 続けてMを書く
      await user.click(screen.getByTestId("score-button-M"));
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10", "9", "M"]));

      // Then: 2回目の始点は、次の空白への差(-36)に途中の変形を足した位置になる
      expect(startsOf("provisional-shot")).toEqual([
        "translate(-36px, 0px)",
        "translate(-26px, 5px)",
      ]);
    });

    it("動いている途中の玉の位置が変わらない反映では、動きを止めず動かし直さない", async () => {
      // Given: 9をXへ直し、2つの玉が動いている途中
      const user = userEvent.setup();
      await rewriteNineToX();
      const calls = vi.mocked(HTMLElement.prototype.animate).mock.calls.length;

      // When: 玉を押して指し替える(玉の位置は変わらない)
      await user.click(screen.getByTestId("shot-ball-1-1-2"));

      // Then
      expect(cancelled()).toBe(0);
      expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(calls);
    });

    it("動いている途中で玉の領域の幅が変わると、動きを止め、動かさない", async () => {
      // Given: 9をXへ直し、2つの玉が動いている途中
      const user = userEvent.setup();
      const width = vi
        .spyOn(HTMLElement.prototype, "clientWidth", "get")
        .mockReturnValue(216);
      await rewriteNineToX();
      const calls = vi.mocked(HTMLElement.prototype.animate).mock.calls.length;

      // When: 幅が変わった後に描き直す
      width.mockReturnValue(320);
      await user.click(screen.getByTestId("shot-ball-1-1-2"));

      // Then
      expect(cancelled()).toBe(2);
      expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(calls);
    });

    it("動いている途中で動きを減らす設定にすると、動きを止める", async () => {
      // Given: 9をXへ直し、2つの玉が動いている途中
      const user = userEvent.setup();
      await rewriteNineToX();
      const calls = vi.mocked(HTMLElement.prototype.animate).mock.calls.length;

      // When: 動きを減らす設定にした後に描き直す
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) =>
          ({
            matches: query === "(prefers-reduced-motion: reduce)",
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      );
      await user.click(screen.getByTestId("shot-ball-1-1-2"));

      // Then
      expect(cancelled()).toBe(2);
      expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(calls);
    });

    // 矢数6のエンドに10があり、9を書いて仮の矢だけが動いている途中にする。
    async function writeNineWithProvisionalMoving() {
      const user = userEvent.setup();
      setup({
        distances: [{ ...distanceA, arrows_per_end: 6 }],
        initialShots: [shotRow("s-10", distanceA.id, 1, "10", 10)],
      });
      await user.click(screen.getByTestId("score-button-9"));
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10", "9"]));
      expect(startsOf("provisional-shot")).toHaveLength(1);
      return user;
    }

    it("仮の矢が動いている途中で玉の領域の幅が変わると、仮の矢の動きを止め、動かさない", async () => {
      // Given: 仮の矢が動いている途中
      const width = vi
        .spyOn(HTMLElement.prototype, "clientWidth", "get")
        .mockReturnValue(216);
      const user = await writeNineWithProvisionalMoving();
      const calls = vi.mocked(HTMLElement.prototype.animate).mock.calls.length;

      // When: 描画のたびに幅が変わる状態にして、続けてMを書く
      let measured = 320;
      width.mockImplementation(() => ++measured);
      await user.click(screen.getByTestId("score-button-M"));
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10", "9", "M"]));

      // Then
      expect(cancelled()).toBe(1);
      expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(calls);
    });

    it("仮の矢が動いている途中で動きを減らす設定にすると、仮の矢の動きを止め、動かさない", async () => {
      // Given: 仮の矢が動いている途中
      const user = await writeNineWithProvisionalMoving();
      const calls = vi.mocked(HTMLElement.prototype.animate).mock.calls.length;

      // When: 動きを減らす設定にした後に、続けてMを書く
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) =>
          ({
            matches: query === "(prefers-reduced-motion: reduce)",
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      );
      await user.click(screen.getByTestId("score-button-M"));
      await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10", "9", "M"]));

      // Then
      expect(cancelled()).toBe(1);
      expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(calls);
    });
  });
});

describe("ScorecardClient 玉の折り返し", () => {
  it("玉の領域に矢数分の玉が収まらないときは、矢数から決めた段の数の高さを確保する", () => {
    // Given: 玉の領域の幅が玉3つ分(108px)と測れる
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

    // When: 矢数6の距離を表示する
    setup({ distances: [{ ...distanceA, arrows_per_end: 6 }] });

    // Then: 2段分(80px)の高さを確保し、番号・小計は行全体の上下中央に置く
    const area = screen.getByTestId("end-blank-1-1").parentElement;
    expect(area).toHaveStyle({ minHeight: "80px" });
    expect(screen.getByTestId("end-row-1-1")).toHaveClass("items-center");
  });

  it("矢数分の場所を、段の数で割った同じ数の列に並べ、記録済みの玉を左から入れる", () => {
    // Given: 玉の領域の幅が場所4つ分(144px)と測れる
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

    // When: 矢数6の距離で、エンド1に2本記録済み
    setup({
      distances: [{ ...distanceA, arrows_per_end: 6 }],
      initialShots: [
        shotRow("s-1", distanceA.id, 1, "10", 10),
        shotRow("s-2", distanceA.id, 1, "9", 9),
      ],
    });

    // Then: 3列2段に、玉2つと空白4つを順に置く
    const area = screen.getByTestId("end-blank-1-1")
      .parentElement as HTMLElement;
    expect(area).toHaveStyle({
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      minHeight: "80px",
    });
    expect(
      [...area.children].map((c) => c.getAttribute("data-testid")),
    ).toEqual([
      "shot-ball-1-1-1",
      "shot-ball-1-1-2",
      "end-blank-1-1",
      "end-slot-1-1-4",
      "end-slot-1-1-5",
      "end-slot-1-1-6",
    ]);
  });
});

describe("ScorecardClient テンキーの開閉と配置", () => {
  it("閉じたテンキーは、格納アニメーションの後に取り除く", async () => {
    // Given: 最初のマスが選択され、テンキーが開いている
    const user = userEvent.setup();
    setup();

    // When: テンキーを閉じる
    await user.click(screen.getByTestId("keypad-toggle"));

    // Then: 格納中は表示し続け、格納が終わると取り除く
    expect(screen.getByTestId("score-button-10")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("score-button-10")).not.toBeInTheDocument();
    });
  });

  it("テンキーを閉じると、押した空白に残るフォーカスを外す", async () => {
    // Given: エンド2の空白を押して指している
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("end-blank-1-2"));
    expect(screen.getByTestId("end-blank-1-2")).toHaveFocus();

    // When: テンキーを閉じる
    // iOSのSafariなど、ボタンをタップしてもフォーカスが移らない環境を模すため、フォーカスを移さないfireEventで押す。
    fireEvent.click(screen.getByTestId("keypad-toggle"));

    // Then: 空白のフォーカスが外れる
    expect(screen.getByTestId("end-blank-1-2")).not.toHaveFocus();
  });

  it("横向きの場合は、テンキーをボトムシートではなく横の側パネルに表示する", () => {
    // Given: 横向きの画面
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: query === "(orientation: landscape)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    // When: 表示する（初期表示）
    setup();

    // Then: 側パネルにテンキーを表示し、ボトムシートの閉じるボタンは表示しない
    expect(
      within(screen.getByTestId("keypad-panel")).getByTestId("score-button-10"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("keypad-toggle")).not.toBeInTheDocument();
  });
});

describe("ScorecardClient 指している矢へのスクロール", () => {
  // jsdomはレイアウトを計算しないため、エンドの行とスクロール領域（<main>）の表示位置を境界として与える。
  // 未記録のラウンドはマウント時点でエンド1の新しい矢を指すため、エンド1の行の位置で検証する。
  function stubLayout({
    cell,
    container,
  }: {
    cell: { top: number; bottom: number };
    container: { top: number; bottom: number };
  }) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const rect =
          this.tagName === "MAIN"
            ? container
            : this.getAttribute("data-testid") === "end-row-1-1"
              ? cell
              : { top: 0, bottom: 0 };
        return {
          ...rect,
          x: 0,
          y: rect.top,
          left: 0,
          right: 0,
          width: 0,
          height: rect.bottom - rect.top,
          toJSON: () => ({}),
        };
      },
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("テンキーの実測の高さが変わり、選択中のマスがテンキーに隠れる場合は、隠れる分だけ下へスクロールする", () => {
    // Given: 高さ800の領域の500〜540にマスがあり、テンキーの高さを測れていない（既定の220を見込む）ため隠れていない
    let reportKeypadHeight: (height: number) => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          reportKeypadHeight = (height) =>
            callback(
              [{ contentRect: { height } } as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            );
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    stubLayout({
      cell: { top: 500, bottom: 540 },
      container: { top: 0, bottom: 800 },
    });
    setup();
    expect(Element.prototype.scrollBy).not.toHaveBeenCalled();

    // When: テンキーの高さが300と測れる
    act(() => reportKeypadHeight(300));

    // Then: 見える下端（800-300-余白16=484）を超えた56だけ下へスクロールする
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollBy).toHaveBeenCalledWith({
      top: 56,
      behavior: "smooth",
    });
  });

  it("選択中のマスが表示領域より上にある場合は、上端の余白の位置まで上へスクロールする", () => {
    // Given: マスが表示領域の上端（0）より上の-100〜-60にある
    stubLayout({
      cell: { top: -100, bottom: -60 },
      container: { top: 0, bottom: 800 },
    });

    // When: 表示する（初期表示で最初のマスを選択する）
    setup();

    // Then: 上端の余白16の位置まで、116だけ上へスクロールする
    expect(Element.prototype.scrollBy).toHaveBeenLastCalledWith({
      top: -116,
      behavior: "smooth",
    });
  });

  it("指す位置とテンキーの高さが変わらないまま再描画されても、スクロールし直さない", () => {
    // Given: マスが隠れていて、表示でスクロールした後、利用者が別の位置へスクロールした
    stubLayout({
      cell: { top: 760, bottom: 790 },
      container: { top: 0, bottom: 800 },
    });
    const { rerender } = setup();
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);

    // When: 同じ内容を作り直して再描画する(取得や再計算で、距離などが作り直される)
    rerender(
      <ScorecardClient
        roundId="round-1"
        loaded={{
          base: roundTablesFromServer({
            status: "in_progress",
            roundConfig,
            distances: [{ ...distanceA }],
            shots: [],
          }),
          group: { base: undefined, entries: [] },
          source: "server",
        }}
        targetFaces={[...targetFaces]}
      />,
    );

    // Then: 利用者のスクロールを入力位置へ戻さない
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(1);
  });

  it("選択中のマスが見えている場合は、スクロールしない", () => {
    // Given: マスが表示領域内の100〜140にある
    stubLayout({
      cell: { top: 100, bottom: 140 },
      container: { top: 0, bottom: 800 },
    });

    // When: 表示する（初期表示で最初のマスを選択する）
    setup();

    // Then: スクロールしない
    expect(Element.prototype.scrollBy).not.toHaveBeenCalled();
  });

  it("横向きの場合は、テンキーの高さを見込まずにスクロールする", () => {
    // Given: 横向きの画面で、マスが表示領域の下端近くの760〜790にある
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: query === "(orientation: landscape)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    stubLayout({
      cell: { top: 760, bottom: 790 },
      container: { top: 0, bottom: 800 },
    });

    // When: 表示する（初期表示で最初のマスを選択する）
    setup();

    // Then: 見える下端（800-余白16=784）を超えた6だけ下へスクロールする
    expect(Element.prototype.scrollBy).toHaveBeenLastCalledWith({
      top: 6,
      behavior: "smooth",
    });
  });
});

describe("ScorecardClient 一つ戻る・一つ進む", () => {
  it("記録を戻すとその矢が消えてそのエンドの新しい矢を指し、進むと同じ矢を記録し直して指す", async () => {
    // Given: エンド1に10を記録している
    const user = userEvent.setup();
    setup();
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
    await user.click(screen.getByTestId("score-button-10"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));

    // When: 一つ戻る
    await user.click(screen.getByTestId("score-button-undo"));

    // Then: 矢が消え、進むだけが有効になり、同じ矢のクリアがSDKへ届く
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
    expect(provisionalEnd()).toBe("end-row-1-1");
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeEnabled();
    await waitFor(() => expect(sentShots("clear_shots")).toHaveLength(1));
    const [recorded] = sentShots("record_shots");
    expect(sentShots("clear_shots")[0].shot_id).toBe(recorded.shot_id);

    // When: 一つ進む
    await user.click(screen.getByTestId("score-button-redo"));

    // Then: 同じ矢が戻り、その矢を指し、戻るだけが有効になる
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    expect(screen.getByTestId("shot-ball-1-1-1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("score-button-undo")).toBeEnabled();
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
    await waitFor(() => expect(sentShots("record_shots")).toHaveLength(2));
    expect(sentShots("record_shots")[1].shot_id).toBe(recorded.shot_id);

    // When: もう一度戻り、そのまま別の点数を書く
    await user.click(screen.getByTestId("score-button-undo"));
    await user.click(screen.getByTestId("score-button-9"));

    // Then: エンド1の新しい矢へ記録し、やり直しの列は捨てられる
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
  });

  it("直した矢を戻すと、直す前の点数だけを射手なしで書き、その矢を指す", async () => {
    // Given: 10の矢を9へ直している
    const user = userEvent.setup();
    setup({ initialShots: [shotRow("s-1", distanceA.id, 1, "10", 10)] });
    await user.click(screen.getByTestId("shot-ball-1-1-1"));
    await user.click(screen.getByTestId("score-button-9"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));

    // When: 一つ戻る
    await user.click(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    expect(screen.getByTestId("shot-ball-1-1-1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => {
      expect(sentShots("record_shots").at(-1)).toEqual({
        shot_event_id: expect.any(String),
        shot_id: "s-1",
        distance_id: distanceA.id,
        end_number: 1,
        score_str: "10",
        score_int: 10,
      });
    });
  });

  it("クリアした矢を戻すと、同じ矢がクリア前の点数で戻る", async () => {
    // Given: 10の矢をクリアしている
    const user = userEvent.setup();
    setup({ initialShots: [shotRow("s-1", distanceA.id, 1, "10", 10)] });
    await user.click(screen.getByTestId("shot-ball-1-1-1"));
    await user.click(screen.getByTestId("score-button-clear"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));

    // When: 一つ戻る
    await user.click(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    await waitFor(() => {
      expect(sentShots("record_shots").at(-1)).toEqual(
        expect.objectContaining({ shot_id: "s-1", score_str: "10" }),
      );
    });
  });

  it("エンドの最後の矢を記録して次のエンドへ移った直後に戻ると、前のエンドの矢が消えて前のエンドを指す", async () => {
    // Given: エンド1の2本を記録し、エンド2へ移っている
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-9"));
    await waitFor(() => expect(provisionalEnd()).toBe("end-row-1-2"));

    // When
    await user.click(screen.getByTestId("score-button-undo"));

    // Then
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
    expect(provisionalEnd()).toBe("end-row-1-1");
  });

  it("戻すと矢が復活するが、そのエンドが他のタブの矢で矢数に達しているときは、何も積まずに列だけを進める", async () => {
    // Given: 1本のエンドの矢をクリアした後、他のタブがそのエンドへ矢を記録した
    const user = userEvent.setup();
    setup({
      distances: [{ ...distanceA, arrows_per_end: 1 }],
      initialShots: [shotRow("s-1", distanceA.id, 1, "10", 10)],
    });
    await user.click(screen.getByTestId("shot-ball-1-1-1"));
    await user.click(screen.getByTestId("score-button-clear"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
    await act(() =>
      roundOpLog.round("round-1").append({
        type: "shot.recorded",
        eventId: "e-other-tab",
        shotId: "s-other",
        distanceId: distanceA.id,
        endNumber: 1,
        scoreStr: "9",
        scoreInt: 9,
      }),
    );
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["9"]));

    // When: 一つ戻る
    await user.click(screen.getByTestId("score-button-undo"));

    // Then: 矢は戻らず、記録も積まれず、列だけが進む
    await flushMicrotasks();
    expect(ballsOf(1, 1)).toEqual(["9"]);
    expect(
      sentShots("record_shots").filter((shot) => shot.shot_id === "s-1"),
    ).toEqual([]);
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeEnabled();
  });
});

describe("ScorecardClient 距離の追加・編集・削除", () => {
  it("距離を追加すると、追加した距離の作成がSDKへ届き、その距離の編集パネルが展開される", async () => {
    // Given: 距離が1つある
    const user = userEvent.setup();
    setup();

    // When: 距離を追加する
    await user.click(screen.getByTestId("add-distance-button"));

    // Then: 2つ目の距離の編集パネルが直前の距離の内容で開き、その作成がSDKへ届く
    expect(screen.getByTestId("distance-config-distance-2")).toHaveValue(70);
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith(
        "create_distance",
        expect.objectContaining({
          p_round_id: "round-1",
          p_position_key: "b",
          p_distance: 70,
          p_total_ends: 2,
          p_arrows_per_end: 2,
          p_target_face_id: targetFaceX.id,
          p_is_marked: true,
        }),
      );
    });
  });

  it("構成が変わる設定で距離を保存すると、その距離のUndo/Redo履歴だけが破棄され、他の距離の履歴は残る", async () => {
    // Given: 2つ目の距離の記録がUndo履歴に、1つ目の距離の取り消した記録がRedo履歴に残っている
    // 的はスコアが記録済みの距離では変更できないため、1つ目の距離は取り消して記録の無い状態にする。
    const user = userEvent.setup();
    setup({ distances: [distanceA, distanceB] });
    await user.click(screen.getByTestId("end-blank-2-1"));
    await user.click(screen.getByTestId("score-button-9"));
    await waitFor(() => expect(ballsOf(2, 1)).toEqual(["9"]));
    await user.click(screen.getByTestId("end-blank-1-1"));
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-undo"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual([]));
    expect(screen.getByTestId("score-button-undo")).toBeEnabled();
    expect(screen.getByTestId("score-button-redo")).toBeEnabled();

    // When: 1つ目の距離の的を変更して保存する
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("target-face-picker-trigger"));
    await user.click(screen.getByTestId("target-face-format-tab-all"));
    await user.click(screen.getByTestId("target-face-bow-type-tab-all"));
    await user.click(
      screen.getByTestId(`target-face-option-${targetFaceNoX.id}`),
    );
    await user.click(screen.getByTestId("distance-config-save-1"));

    // Then: 1つ目の距離のRedo履歴は破棄され、2つ目の距離のUndo履歴は残る
    // 指している新しい矢は新しい構成でも有効なため、テンキーは開いたまま。
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
    expect(screen.getByTestId("score-button-undo")).toBeEnabled();

    // When: Undoする
    await user.click(screen.getByTestId("score-button-undo"));

    // Then: 2つ目の距離の記録が取り消される
    await waitFor(() => expect(ballsOf(2, 1)).toEqual([]));
  });

  it("構成が変わらない設定で距離を保存すると、Undo/Redo履歴は維持される", async () => {
    // Given: 1-1-1に記録している
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("score-button-10"));

    // When: その距離を設定を変えずに保存する
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("distance-config-save-1"));

    // Then: Undoは有効のまま
    expect(screen.getByTestId("score-button-undo")).not.toBeDisabled();
  });

  it("距離編集パネルをEscapeで閉じると、保存せずパネルが閉じる", async () => {
    // Given: 距離の編集パネルを開いている
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    expect(
      screen.getByTestId("distance-config-distance-1"),
    ).toBeInTheDocument();

    // When: Escapeを押す
    await user.keyboard("{Escape}");

    // Then: パネルが閉じ、操作の列へは何も積まれない
    expect(
      screen.queryByTestId("distance-config-distance-1"),
    ).not.toBeInTheDocument();
    expect(roundOpLog.round("round-1").getSnapshot().items).toEqual([]);
    await flushMicrotasks();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("スコア記録済みの距離を確認の上で削除すると、その距離・記録・Undo履歴・指している矢が破棄される", async () => {
    // Given: 2つの距離があり、1つ目の距離に記録して、その距離の新しい矢を指している
    const user = userEvent.setup();
    setup({ distances: [distanceA, distanceB] });
    await user.click(screen.getByTestId("score-button-10"));
    expect(screen.getByText("合計10")).toBeInTheDocument();

    // When: 1つ目の距離を確認の上で削除する
    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("distance-config-delete-1"));
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    // Then: 残った距離が1つ目として表示され、記録が合計から除かれ、Undoは無効になる
    expect(screen.queryByTestId("distance-summary-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("distance-summary-1")).toBeInTheDocument();
    expect(screen.getByText("合計0")).toBeInTheDocument();
    expect(provisionalEnd()).toBeNull();
    await user.click(screen.getByTestId("end-blank-1-1"));
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
  });

  it("指している矢が無い距離を削除すると、指している矢はそのまま残る", async () => {
    // Given: 2つの距離があり、1つ目の距離のエンド1の新しい矢を指している
    const user = userEvent.setup();
    setup({ distances: [distanceA, distanceB] });

    // When: 記録の無い2つ目の距離を削除する
    await user.click(screen.getByTestId("distance-config-toggle-2"));
    await user.click(screen.getByTestId("distance-config-delete-2"));

    // Then: 2つ目の距離は無くなり、テンキーの入力は指していた1つ目の距離のエンドに記録される
    expect(screen.queryByTestId("distance-summary-2")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("score-button-10"));
    await waitFor(() => expect(ballsOf(1, 1)).toEqual(["10"]));
  });
});

describe("ScorecardClient プリセット保存", () => {
  it("プリセット保存ダイアログから保存すると、ラウンド名とスコアカードの現在の構成がSDKへ届く", async () => {
    // Given: 2つの距離があるスコアカード
    const user = userEvent.setup();
    setup({ distances: [distanceA, distanceB] });

    // When: プリセット保存ダイアログを開き、事前入力された名前のまま保存する
    await user.click(screen.getByTestId("save-as-preset-trigger"));
    await user.click(screen.getByTestId("save-as-preset-confirm"));

    // Then: ラウンド名とスコアカードの種別・弓種・距離構成がSDKへ届き、ダイアログが閉じる
    await waitFor(() => {
      expect(
        screen.queryByTestId("save-as-preset-name"),
      ).not.toBeInTheDocument();
    });
    expect(supabase.rpc).toHaveBeenCalledWith("save_round_as_preset", {
      p_name: "テストラウンド",
      p_format: "outdoor",
      p_bow_type: "recurve",
      p_distances: [
        {
          position_key: "a",
          distance: 70,
          total_ends: 2,
          arrows_per_end: 2,
          target_face_id: targetFaceX.id,
          is_marked: true,
        },
        {
          position_key: "b",
          distance: 50,
          total_ends: 1,
          arrows_per_end: 1,
          target_face_id: targetFaceX.id,
          is_marked: true,
        },
      ],
    });
  });
});

describe("ScorecardClient ラウンド削除", () => {
  it("ラウンドのメニューから削除を確認すると、このラウンドのdisable_roundを実行し、一覧へ置き換えて遷移する", async () => {
    // Given: ラウンドを表示している
    const user = userEvent.setup();
    setup();

    // When: ラウンドのメニューから削除を確認する
    await user.click(screen.getByTestId("round-menu-trigger"));
    await user.click(await screen.findByTestId("round-delete"));
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    // Then: このラウンドのdisable_roundを実行し、一覧へ置き換えて遷移する
    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("/rounds");
    });
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("disable_round", {
        p_round_event_id: expect.any(String),
        p_round_id: "round-1",
      });
    });
  });
});

// 同期の状態(枠、文言)を表示していない。
function expectNoSyncStatus() {
  expect(screen.queryByTestId("sync-status")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/同期済み|同期中…|同期保留中/),
  ).not.toBeInTheDocument();
}

// round-1の列の操作の状態。
function itemStatuses() {
  return roundOpLog
    .round("round-1")
    .getSnapshot()
    .items.map((item) => item.status);
}

describe("ScorecardClient 同期の状態を表示しない", () => {
  it("送信中も、応答が返った後も、同期の状態を表示しない", async () => {
    // Given: RPCの応答を任意の時点で返せる
    let resolveRpc: (value: { data: unknown; error: null }) => void = () => {};
    supabase.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );
    const user = userEvent.setup();
    setup();

    // When: スコアを入力する
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 記録がSDKへ送られ、応答待ちの間も同期の状態を表示しない
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("record_shots", {
        p_shots: [
          {
            shot_event_id: expect.any(String),
            shot_id: expect.any(String),
            distance_id: distanceA.id,
            end_number: 1,
            score_str: "10",
            score_int: 10,
          },
        ],
      });
    });
    expect(itemStatuses()).toEqual(["inflight"]);
    expectNoSyncStatus();

    // When: 応答が返る
    resolveRpc({ data: [APPLIED], error: null });

    // Then: 確定した後も同期の状態を表示しない
    await waitFor(() => {
      expect(itemStatuses()).toEqual(["acked"]);
    });
    expectNoSyncStatus();
  });

  it("送信が一時的に失敗してリトライを待つ間も、再送が成功した後も、同期の状態を表示しない", async () => {
    // Given: RPCが初回だけ再試行で解消し得るエラーを返す
    // fake-indexeddbはsetImmediateで処理を進めるため、リトライ待機のタイマーと、再送の期限の判定に使う時刻だけを偽装する。
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "通信に失敗しました", code: "" },
    });
    setup();

    // When: スコアを入力し、送信が失敗する
    // userEventはsetTimeoutで待機するため、fake timers中はfireEventで操作する。
    fireEvent.click(screen.getByTestId("score-button-10"));
    await pollWithRealTasks(() =>
      expect(supabase.rpc).toHaveBeenCalledWith(
        "record_shots",
        expect.anything(),
      ),
    );
    await flushMicrotasks();

    // Then: リトライを待つ間、失敗も同期の状態も表示しない
    expect(itemStatuses()).toEqual(["backoff"]);
    expectNoSyncStatus();

    // When: リトライ待機が経過し、再送が成功する
    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryDelayMs(0));
    });

    // Then: 確定した後も同期の状態を表示しない
    await pollWithRealTasks(() => expect(itemStatuses()).toEqual(["acked"]));
    expectNoSyncStatus();
  });

  it("オフライン中は送らず、同期の状態を表示しない", async () => {
    // Given: オフライン
    setOnline(false);
    const user = userEvent.setup();
    setup();

    // When: スコアを入力する
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 送らずに残し、同期の状態を表示しない
    await waitFor(() => {
      expect(itemStatuses()).toEqual(["queued"]);
    });
    expectNoSyncStatus();
    await flushMicrotasks();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("サーバーが契約の不一致で拒否した操作は破棄し、エラーも同期の状態も表示しない", async () => {
    // Given: RPCがPT422で拒否する
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "invalid", code: "PT422" },
      status: 400,
    });
    const user = userEvent.setup();
    setup();

    // When: スコアを入力する
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 操作は破棄され、ダイアログも同期の状態も表示しない
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith(
        "record_shots",
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(itemStatuses()).toEqual([]);
    });
    expectNoSyncStatus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("未認証で送信できない間も、同期の状態を表示しない", async () => {
    // Given: セッションが無い
    supabase.getSession.mockResolvedValue({ data: { session: null } });
    const user = userEvent.setup();
    setup();

    // When: スコアを入力する
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 送らずに保留し、同期の状態を表示しない
    await waitFor(() => {
      expect(itemStatuses()).toEqual(["held"]);
    });
    expectNoSyncStatus();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

// update_roundへ送られた状態の列。
function sentStatuses() {
  return supabase.rpc.mock.calls
    .filter(([name]) => name === "update_round")
    .map(([, args]) => args.p_changes.status);
}

describe("ScorecardClient ラウンドの完了", () => {
  const recorded = shotRow("s-1", "distance-b", 1, "10", 10);

  it("全てのエンドが矢数に達した入力中のラウンドで完了ボタンを押すと、確認なしで完了にし、ボタンを消して状態を送る", async () => {
    // Given
    const user = userEvent.setup();
    setup({ distances: [distanceB], initialShots: [recorded] });

    // When
    await user.click(screen.getByTestId("complete-round-button"));

    // Then
    await waitFor(() => expect(sentStatuses()).toEqual(["completed"]));
    expect(screen.queryByTestId("complete-round-button")).toBeNull();
    expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
  });

  it("矢数に達していないエンドがあるときは、確認でキャンセルすると入力中のままで何も送らない", async () => {
    // Given
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("complete-round-button"));

    // When
    await user.click(screen.getByTestId("confirm-dialog-cancel"));

    // Then
    expect(screen.getByTestId("complete-round-button")).toBeInTheDocument();
    expect(sentStatuses()).toEqual([]);
  });

  it("完了ボタンを押すと、完了の保存の後にラウンド一覧へ移る", async () => {
    // Given
    const user = userEvent.setup();
    nav.push.mockClear();
    setup({ distances: [distanceB], initialShots: [recorded] });

    // When
    await user.click(screen.getByTestId("complete-round-button"));

    // Then
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/rounds"));
  });

  it("確認でキャンセルすると、一覧へ移らない", async () => {
    // Given
    const user = userEvent.setup();
    nav.push.mockClear();
    setup();
    await user.click(screen.getByTestId("complete-round-button"));

    // When
    await user.click(screen.getByTestId("confirm-dialog-cancel"));

    // Then
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("距離が無いラウンドでは、記録がない旨の確認を出す", async () => {
    // Given
    const user = userEvent.setup();
    setup({ distances: [] });

    // When
    await user.click(screen.getByTestId("complete-round-button"));

    // Then
    expect(
      screen.getByText("記録がありません。入力を完了しますか？"),
    ).toBeInTheDocument();
  });

  it("完了のラウンドは、新しい矢を指さず、テンキーを展開しない", () => {
    // Given / When
    setup({ status: "completed" });

    // Then
    expect(screen.queryByTestId("score-button-10")).toBeNull();
    expect(provisionalEnd()).toBeNull();
    expect(screen.queryByTestId("complete-round-button")).toBeNull();
  });

  it("完了のラウンドは、距離が無くてもラウンド編集欄を自動で開かない", () => {
    // Given / When
    setup({ status: "completed", distances: [] });

    // Then
    expect(screen.queryByTestId("round-config-name")).toBeNull();
  });

  it("入力中のラウンドは、矢数に達していない最初のエンドの新しい矢を指してテンキーを展開する", () => {
    // Given / When
    setup();

    // Then
    expect(screen.getByTestId("score-button-10")).toBeInTheDocument();
  });

  it("完了のラウンドでは完了ボタンを表示せず、エンドの空白を押して点数を記録すると入力中へ戻して再表示する", async () => {
    // Given
    const user = userEvent.setup();
    setup({ status: "completed" });
    expect(screen.queryByTestId("complete-round-button")).toBeNull();

    // When
    await user.click(screen.getByTestId("end-blank-1-1"));
    await user.click(screen.getByTestId("score-button-10"));

    // Then
    await waitFor(() => expect(sentStatuses()).toEqual(["in_progress"]));
    expect(screen.getByTestId("complete-round-button")).toBeInTheDocument();
  });

  it("完了のラウンドで記録済みの矢に同じ点数を書いても、入力中へ戻さない", async () => {
    // Given
    const user = userEvent.setup();
    setup({
      status: "completed",
      distances: [distanceB],
      initialShots: [recorded],
    });

    // When
    await user.click(screen.getByTestId("shot-ball-1-1-1"));
    await user.click(screen.getByTestId("score-button-10"));

    // Then
    await waitFor(() => expect(sentShots("record_shots")).toHaveLength(1));
    expect(sentStatuses()).toEqual([]);
    expect(screen.queryByTestId("complete-round-button")).toBeNull();
  });
});

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
    targetFaces?: TargetFaceOption[] | null;
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
        entries: [],
        reflected: [],
      }}
      targetFaces={faces}
    />,
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
  // オフラインで保留中の操作はonlineイベントで再開させ、同期済みか同期保留中の最終状態になるまで待つ。
  // Testing Libraryのcleanup（アンマウント）より先に実行される。
  try {
    const syncStatus = screen.queryByTestId("sync-status");
    if (!syncStatus) return;
    act(() => {
      roundOpHub.handleOnline();
    });
    await waitFor(() => {
      expect(syncStatus.textContent).toMatch(/同期済み|同期保留中/);
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
      initialShots: [
        {
          distance_id: distanceB.id,
          end_number: 1,
          arrow_number: 1,
          score_str: "5",
          score_int: 5,
        },
      ],
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
    const shotOnA = {
      distance_id: distanceA.id,
      end_number: 1,
      arrow_number: 1,
      score_str: "9",
      score_int: 9,
    };

    it("的の一覧の取得中(null)は、距離の行に読み込み中を表示し、距離・本数・エンド数と記録済みの点数は維持する", () => {
      // Given: 的の一覧が取得中で、1本記録済みの距離
      setup({ targetFaces: null, initialShots: [shotOnA] });

      // When: 表示する（初期表示）
      // Then: 的は読み込み中で、距離・本数・エンド数と記録済みの点数が残り
      const row = screen.getByTestId("distance-config-toggle-1");
      expect(row.querySelector("[aria-busy='true']")).not.toBeNull();
      expect(row).toHaveTextContent("70m");
      expect(row).toHaveTextContent("2本×2エンド");
      expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("9");
      expect(document.body).not.toHaveTextContent("的データを取得できません");
    });

    it("的の一覧が空で取得が完了している場合は、「的データを取得できません」を表示し、距離・本数・エンド数と記録済みの点数は維持する", () => {
      setup({ targetFaces: [], initialShots: [shotOnA] });

      const row = screen.getByTestId("distance-config-toggle-1");
      expect(row).toHaveTextContent("的データを取得できません");
      expect(row).toHaveTextContent("70m");
      expect(row).toHaveTextContent("2本×2エンド");
      expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("9");
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

  it("すべてのマスが記録済みの場合、マウント時にテンキーは開かない", () => {
    // Given: 距離の全てのマスが記録済み
    setup({
      initialShots: [
        {
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 1,
          score_str: "10",
          score_int: 10,
        },
        {
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 2,
          score_str: "9",
          score_int: 9,
        },
        {
          distance_id: distanceA.id,
          end_number: 2,
          arrow_number: 1,
          score_str: "X",
          score_int: 10,
        },
        {
          distance_id: distanceA.id,
          end_number: 2,
          arrow_number: 2,
          score_str: "9",
          score_int: 9,
        },
      ],
    });

    // When: 表示する（初期表示）
    // Then: テンキーは開かない
    expect(screen.queryByTestId("score-button-10")).not.toBeInTheDocument();
  });

  it("記録済みのマスは、リングの色相・彩度のまま明度を上げた背景色と黒の文字色で表示する", () => {
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
        {
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 1,
          score_str: "8",
          score_int: 8,
        },
        {
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 2,
          score_str: "2",
          score_int: 2,
        },
      ],
    });

    // When: 表示する（初期表示）
    // Then: 赤は薄い赤、無彩色の白は薄い灰色の背景になり、文字色はいずれも黒になる
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveStyle({
      backgroundColor: "#FDCED1",
      color: "#231F20",
    });
    expect(screen.getByTestId("shot-cell-1-1-2")).toHaveStyle({
      backgroundColor: "#E6E6E6",
      color: "#231F20",
    });
  });

  it("テンキーの閉じるボタンで選択を解除すると、格納中のテンキーへの入力は無視される", async () => {
    // Given: 最初のマスが選択されている
    const user = userEvent.setup();
    setup();

    // When: テンキーを閉じ、格納が終わる前に点数とCを押す
    await user.click(screen.getByTestId("keypad-toggle"));
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-clear"));

    // Then: マスは記録されず、SDKへも送られない
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("");
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

// 操作の列がSDKへ送ったマスの操作を、呼び出しをまたいで順に並べる。
function sentShots(rpcName: "record_shots" | "clear_shots") {
  return supabase.rpc.mock.calls
    .filter(([name]) => name === rpcName)
    .flatMap(([, args]) => args.p_shots);
}

describe("ScorecardClient マス選択とスコア入力", () => {
  // 未記録のラウンドは、マウント時点で最初のマス（1-1-1）が選択され、テンキーが開いている。
  // そのため以下のテストでは1-1-1を明示的にタップしない（選択中マスの再タップは選択の解除になる）。

  it("スコアを入力すると、選択中のマスに記録して次のマスへ進み、記録がSDKへ届く", async () => {
    // Given: 最初のマスが選択されている
    const user = userEvent.setup();
    setup();

    // When: 10とMを続けて入力する
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-M"));

    // Then: 入力ごとに次のマスへ進んで記録され、それぞれの記録がSDKへ届く
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("10");
    expect(screen.getByTestId("shot-cell-1-1-2")).toHaveTextContent("M");
    await waitFor(() => {
      expect(sentShots("record_shots")).toEqual([
        expect.objectContaining({
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 1,
          score_str: "10",
          score_int: 10,
        }),
        expect.objectContaining({
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 2,
          score_str: "M",
          score_int: 0,
        }),
      ]);
    });
  });

  it("テンキーは距離の的のリング色と、その色に応じた文字色で表示する", () => {
    // Given: Xの無い的の距離が選択されている
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

  it("Cボタンで選択中マスの記録をクリアして1つ前のマスへ戻り、クリアがSDKへ届く", async () => {
    // Given: 1-1-1と1-1-2に記録し、1-1-2を選択し直している
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-9"));
    await user.click(screen.getByTestId("shot-cell-1-1-2"));

    // When: Cを2回押す
    await user.click(screen.getByTestId("score-button-clear"));
    await user.click(screen.getByTestId("score-button-clear"));

    // Then: 1-1-2をクリアした後に1-1-1へ戻ってクリアし、それぞれのクリアがSDKへ届く
    expect(screen.getByTestId("shot-cell-1-1-2")).toHaveTextContent("");
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("");
    await waitFor(() => {
      expect(sentShots("clear_shots")).toEqual([
        expect.objectContaining({
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 2,
        }),
        expect.objectContaining({
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 1,
        }),
      ]);
    });
  });

  it("未記録のマスでCボタンを押すと、クリアはSDKへ届くが履歴には残らない", async () => {
    // Given: 記録が無く、未記録の1-2-1を選択している
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("shot-cell-1-2-1"));

    // When: Cを押す
    await user.click(screen.getByTestId("score-button-clear"));

    // Then: クリアはSDKへ届くが、Undoは無効のまま
    await waitFor(() => {
      expect(sentShots("clear_shots")).toEqual([
        expect.objectContaining({
          distance_id: distanceA.id,
          end_number: 2,
          arrow_number: 1,
        }),
      ]);
    });
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
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

  it("選択中のマスを再度タップすると、選択を解除してテンキーを格納する", async () => {
    // Given: 最初のマスが選択され、テンキーが開いている
    const user = userEvent.setup();
    setup();
    expect(screen.getByTestId("score-button-10")).toBeInTheDocument();

    // When: 選択中の最初のマスをタップする
    await user.click(screen.getByTestId("shot-cell-1-1-1"));

    // Then: 格納が終わるとテンキーが取り除かれる
    await waitFor(() => {
      expect(screen.queryByTestId("score-button-10")).not.toBeInTheDocument();
    });
  });

  it("距離の最後のマスにスコアを入力すると、記録して選択を外し、テンキーを格納する", async () => {
    // Given: 1マスだけの距離で、そのマスが選択されている
    const user = userEvent.setup();
    setup({ distances: [distanceB] });

    // When: スコアを入力する
    await user.click(screen.getByTestId("score-button-X"));

    // Then: そのマスに記録され、記録がSDKへ届き、テンキーが格納される
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("X");
    await waitFor(() => {
      expect(sentShots("record_shots")).toEqual([
        expect.objectContaining({
          distance_id: distanceB.id,
          end_number: 1,
          arrow_number: 1,
          score_str: "X",
        }),
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("score-button-X")).not.toBeInTheDocument();
    });
  });

  it("距離の最初のマスをクリアすると、前のマスへ戻らずそのマスの選択を保つ", async () => {
    // Given: 最初のマスに記録して、そのマスを選択し直している
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("shot-cell-1-1-1"));

    // When: Cを押す
    await user.click(screen.getByTestId("score-button-clear"));

    // Then: 記録がクリアされ、クリアがSDKへ届く
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("");
    await waitFor(() => {
      expect(sentShots("clear_shots")).toEqual([
        expect.objectContaining({
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 1,
        }),
      ]);
    });

    // When: 続けてスコアを入力する
    await user.click(screen.getByTestId("score-button-9"));

    // Then: テンキーは開いたままで、同じマスに記録される
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("9");
  });

  it("マスをタップすると選択し、選択中のマスを再度タップすると選択を解除する", async () => {
    // Given: 最初のマスが選択されている
    const user = userEvent.setup();
    setup();

    // When: 別のマスをタップしてスコアを入力する
    await user.click(screen.getByTestId("shot-cell-1-2-1"));
    await user.click(screen.getByTestId("score-button-9"));

    // Then: タップしたマスに記録される
    expect(screen.getByTestId("shot-cell-1-2-1")).toHaveTextContent("9");
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("");

    // When: 選択中のマス（記録後に進んだ1-2-2）をタップしてから、格納が終わる前にスコアを押す
    await user.click(screen.getByTestId("shot-cell-1-2-2"));
    await user.click(screen.getByTestId("score-button-X"));

    // Then: 選択が解除されているため、記録されない
    expect(screen.getByTestId("shot-cell-1-2-2")).toHaveTextContent("");
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

  it("テンキーを閉じると、選択していたマスに残るフォーカスを外す", async () => {
    // Given: 2本目のマスをタップして選択している
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("shot-cell-1-1-2"));
    expect(screen.getByTestId("shot-cell-1-1-2")).toHaveFocus();

    // When: テンキーを閉じる
    // iOSのSafariなど、ボタンをタップしてもフォーカスが移らない環境を模すため、フォーカスを移さないfireEventで押す。
    fireEvent.click(screen.getByTestId("keypad-toggle"));

    // Then: マスのフォーカスが外れる
    expect(screen.getByTestId("shot-cell-1-1-2")).not.toHaveFocus();
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

describe("ScorecardClient 選択中のマスへのスクロール", () => {
  // jsdomはレイアウトを計算しないため、マスとスクロール領域（<main>）の表示位置を境界として与える。
  // 未記録のラウンドはマウント時点で最初のマス（1-1-1）が選択されるため、そのマスの位置で検証する。
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
            : this.getAttribute("data-testid")?.startsWith("shot-cell-")
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

describe("ScorecardClient Undo/Redo", () => {
  it("Undo/Redoで記録を巻き戻し・やり直してそのマスを選択し、操作がSDKへ届く", async () => {
    // Given: 1-1-1に10を記録している
    const user = userEvent.setup();
    setup();
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
    await user.click(screen.getByTestId("score-button-10"));

    // When: Undoする
    await user.click(screen.getByTestId("score-button-undo"));

    // Then: 記録が消え、Redoだけが有効になり、クリアがSDKへ届く
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("");
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeEnabled();
    await waitFor(() => {
      expect(sentShots("clear_shots")).toEqual([
        expect.objectContaining({ end_number: 1, arrow_number: 1 }),
      ]);
    });

    // When: Redoする
    await user.click(screen.getByTestId("score-button-redo"));

    // Then: 記録が戻り、Undoだけが有効になり、記録がSDKへ届く
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("10");
    expect(screen.getByTestId("score-button-undo")).toBeEnabled();
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
    await waitFor(() => {
      expect(sentShots("record_shots")).toEqual([
        expect.objectContaining({ end_number: 1, arrow_number: 1 }),
        expect.objectContaining({ end_number: 1, arrow_number: 1 }),
      ]);
    });

    // When: もう一度Undoし、そのまま別のスコアを入力する
    await user.click(screen.getByTestId("score-button-undo"));
    await user.click(screen.getByTestId("score-button-9"));

    // Then: 取り消したマスが選択されているためそのマスに記録され、Redo履歴は破棄される
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("9");
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
  });

  it("上書きしたマスをUndoすると、上書き前の点数に戻り、その記録がSDKへ届く", async () => {
    // Given: 1-1-1に10を記録した後、9で上書きしている
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-9"));
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("9");

    // When: Undoする
    await user.click(screen.getByTestId("score-button-undo"));

    // Then: 空欄でなく上書き前の10に戻り、10の記録がSDKへ届く
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("10");
    await waitFor(() => {
      expect(sentShots("record_shots").at(-1)).toEqual(
        expect.objectContaining({
          end_number: 1,
          arrow_number: 1,
          score_str: "10",
          score_int: 10,
        }),
      );
    });
  });

  it("クリアしたマスをUndoすると、クリア前の点数に戻り、その記録がSDKへ届く", async () => {
    // Given: 1-1-1に10を記録した後、そのマスをクリアしている
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-clear"));
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("");

    // When: Undoする
    await user.click(screen.getByTestId("score-button-undo"));

    // Then: クリア前の10に戻り、10の記録がSDKへ届く
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("10");
    await waitFor(() => {
      expect(sentShots("record_shots").at(-1)).toEqual(
        expect.objectContaining({
          end_number: 1,
          arrow_number: 1,
          score_str: "10",
          score_int: 10,
        }),
      );
    });
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
    await user.click(screen.getByTestId("shot-cell-2-1-1"));
    await user.click(screen.getByTestId("score-button-9"));
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-undo"));
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
    // 保存でマスの選択は解除されるため、マスを選択し直してテンキーを表示する。
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
    expect(screen.getByTestId("score-button-undo")).toBeEnabled();

    // When: Undoする
    await user.click(screen.getByTestId("score-button-undo"));

    // Then: 2つ目の距離の記録が取り消される
    expect(screen.getByTestId("shot-cell-2-1-1")).toHaveTextContent("");
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
    // 操作の列に積まれると送信が完了するまで同期中の表示になるため、同期済みのままであることで積まれていないことを確かめる。
    expect(screen.getByTestId("sync-status")).toHaveTextContent("同期済み");
    await flushMicrotasks();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("スコア記録済みの距離を確認の上で削除すると、その距離・記録・Undo履歴・選択状態が破棄される", async () => {
    // Given: 2つの距離があり、1つ目の距離に記録して、その距離のマスを選択している
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
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
  });

  it("選択中のマスが無い距離を削除すると、選択中のマスはそのまま残る", async () => {
    // Given: 2つの距離があり、1つ目の距離の最初のマスを選択している
    const user = userEvent.setup();
    setup({ distances: [distanceA, distanceB] });

    // When: 記録の無い2つ目の距離を削除する
    await user.click(screen.getByTestId("distance-config-toggle-2"));
    await user.click(screen.getByTestId("distance-config-delete-2"));

    // Then: 2つ目の距離は無くなり、テンキーの入力は選択中だった1つ目の距離のマスに記録される
    expect(screen.queryByTestId("distance-summary-2")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("score-button-10"));
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("10");
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
    expect(supabase.rpc).toHaveBeenCalledWith("disable_round", {
      p_round_event_id: expect.any(String),
      p_round_id: "round-1",
    });
  });
});

describe("ScorecardClient 同期状態の表示", () => {
  it("送信中は「同期中…」を表示し、応答が返ると「同期済み」になる", async () => {
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

    // Then: 記録がSDKへ送られ、応答待ちの間は同期中を表示する
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("record_shots", {
        p_shots: [expect.objectContaining({ score_str: "10" })],
      });
    });
    expect(screen.getByTestId("sync-status")).toHaveTextContent("同期中…");

    // When: 応答が返る
    resolveRpc({ data: [APPLIED], error: null });

    // Then: 同期済みになる
    await waitFor(() => {
      expect(screen.getByTestId("sync-status")).toHaveTextContent("同期済み");
    });
  });

  it("送信が一時的に失敗してリトライを待つ間は「同期中…」を表示する", async () => {
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

    // Then: 失敗は表示せず、同期中の表示のままリトライを待つ
    expect(screen.getByTestId("sync-status")).toHaveTextContent("同期中…");

    // When: リトライ待機が経過し、再送が成功する
    await act(async () => {
      await vi.advanceTimersByTimeAsync(retryDelayMs(0));
    });

    // Then: 同期済みになる
    await pollWithRealTasks(() =>
      expect(screen.getByTestId("sync-status")).toHaveTextContent("同期済み"),
    );
  });

  it("オフライン中は送らず「同期保留中」を表示する", async () => {
    // Given: オフライン
    setOnline(false);
    const user = userEvent.setup();
    setup();

    // When: スコアを入力する
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 同期保留中を表示し、SDKへは送らない
    await waitFor(() => {
      expect(screen.getByTestId("sync-status")).toHaveTextContent("同期保留中");
    });
    await flushMicrotasks();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("送信が完了すると「同期済み」を表示する", async () => {
    // Given: RPCが成功する
    const user = userEvent.setup();
    setup();

    // When: スコアを入力する
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 記録がSDKへ送られ、完了後に同期済みを表示する
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("record_shots", {
        p_shots: [
          expect.objectContaining({
            distance_id: distanceA.id,
            end_number: 1,
            arrow_number: 1,
            shooter_id: "user-1",
            score_str: "10",
            score_int: 10,
          }),
        ],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("sync-status")).toHaveTextContent("同期済み");
    });
  });

  it("サーバーが契約の不一致で拒否した操作は、破棄して同期済みに戻り、エラーは表示しない", async () => {
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

    // Then: 同期済みに戻り、ダイアログも開かない
    await waitFor(() => {
      expect(screen.getByTestId("sync-status")).toHaveTextContent("同期済み");
    });
    await user.click(screen.getByTestId("sync-status"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("未認証で送信できない間は、同期保留中を表示する", async () => {
    // Given: セッションが無い
    supabase.getSession.mockResolvedValue({ data: { session: null } });
    const user = userEvent.setup();
    setup();

    // When: スコアを入力する
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 同期保留中を表示し、RPCは呼ばない
    await waitFor(() => {
      expect(screen.getByTestId("sync-status")).toHaveTextContent("同期保留中");
    });
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
  const recorded = {
    distance_id: "distance-b",
    end_number: 1,
    arrow_number: 1,
    shooter_id: "user-1",
    score_str: "10",
    score_int: 10,
  };

  it("全てのマスを記録済みの入力中のラウンドで完了ボタンを押すと、確認なしで完了にし、ボタンを消して状態を送る", async () => {
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

  it("未入力のマスがあるときは、確認でキャンセルすると入力中のままで何も送らない", async () => {
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

  it("完了のラウンドは、先頭の未入力のマスを選ばず、テンキーを展開しない", () => {
    // Given / When
    setup({ status: "completed" });

    // Then
    expect(screen.queryByTestId("score-button-10")).toBeNull();
    expect(screen.queryByTestId("complete-round-button")).toBeNull();
  });

  it("完了のラウンドは、距離が無くてもラウンド編集欄を自動で開かない", () => {
    // Given / When
    setup({ status: "completed", distances: [] });

    // Then
    expect(screen.queryByTestId("round-config-name")).toBeNull();
  });

  it("入力中のラウンドは、先頭の未入力のマスを選んでテンキーを展開する", () => {
    // Given / When
    setup();

    // Then
    expect(screen.getByTestId("score-button-10")).toBeInTheDocument();
  });

  it("完了のラウンドでは完了ボタンを表示せず、マスを選んで点数を記録すると入力中へ戻して再表示する", async () => {
    // Given
    const user = userEvent.setup();
    setup({ status: "completed" });
    expect(screen.queryByTestId("complete-round-button")).toBeNull();

    // When
    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-10"));

    // Then
    await waitFor(() => expect(sentStatuses()).toEqual(["in_progress"]));
    expect(screen.getByTestId("complete-round-button")).toBeInTheDocument();
  });
});

import "fake-indexeddb/auto";
import { setImmediate as realSetImmediate } from "node:timers";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TargetFaceOption } from "./distance-config-row";
import type { RoundConfig } from "./round-config";
import { ScorecardClient } from "./scorecard-client";
import type { SyncOperation } from "./sync-events";
import { savePendingOperation } from "./sync-outbox";
import { RETRY_DELAYS_MS } from "./sync-result";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

// SupabaseのSDKは外部サービスとの境界のため、セッションの取得結果とRPCの結果を任意に制御できるスタブで模す。
// 画面の操作は、実物のSupabaseクライアントラッパー・送信キューを通してこのスタブのrpcに届く。
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

// 前回の表示中に積まれ、まだ同期されていない操作として、永続outboxに渡した順で書き込む。
// 保存時刻が同じだと読み出し順がeventIdの順になるため、Dateだけを偽装して保存時刻を1msずつずらす。
// テストの端末にはサインインの記録がない（getLocalIdentity()がnull）ため、userIdはnullで書き込む。
async function seedPendingOperations(operations: SyncOperation[]) {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    for (const [index, operation] of operations.entries()) {
      vi.setSystemTime(Date.UTC(2026, 8, 15) + index);
      await savePendingOperation({
        eventId: operation.eventId,
        roundId: "round-1",
        key: `pending:${operation.eventId}`,
        label: operation.type,
        operation,
        userId: null,
      });
    }
  } finally {
    vi.useRealTimers();
  }
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

function setup(overrides: Partial<Parameters<typeof ScorecardClient>[0]> = {}) {
  return render(
    <ScorecardClient
      roundId="round-1"
      initialRoundConfig={roundConfig}
      distances={[distanceA]}
      initialShots={[]}
      targetFaces={targetFaces}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // IndexedDBはfake-indexeddbで代替し、テストごとに空のDBから始める。
  globalThis.indexedDB = new IDBFactory();
  setOnline(true);
  supabase.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
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
  // 送信キューはアンマウント後も送信を続けるため、送信中の操作が次のテストのスタブに届かないよう、マウント中に送信を終わらせる。
  // オフラインで保留中の操作はonlineイベントで再開させ、同期済みか同期失敗の最終状態になるまで待つ。
  // Testing Libraryのcleanup（アンマウント）より先に実行される。
  const syncStatus = screen.queryByTestId("sync-status");
  if (!syncStatus) return;
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() => {
    expect(syncStatus.textContent).toMatch(/同期済み|同期失敗/);
  });
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
    expect(screen.getByTestId("end-subtotal-1-1")).toHaveTextContent("20");
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
});

// 送信キューがSDKへ送ったマスの操作を、呼び出しをまたいで順に並べる。
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
});

describe("ScorecardClient 距離の追加・編集・削除", () => {
  it("距離を追加すると直前の距離の内容を引き継ぎ、編集パネルが自動的に展開される", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("add-distance-button"));

    expect(screen.getByTestId("distance-config-distance-2")).toHaveValue(70);
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith(
        "create_distance",
        expect.objectContaining({
          p_round_id: "round-1",
          p_position_key: "aa",
          p_distance: 70,
          p_total_ends: 2,
          p_arrows_per_end: 2,
          p_target_face_id: targetFaceX.id,
          p_is_marked: true,
        }),
      );
    });
  });

  it("的を変更して距離を保存すると、その距離のUndo/Redo履歴のみが破棄される（他の距離の履歴は残る）", async () => {
    const user = userEvent.setup();
    setup({ distances: [distanceA, distanceB] });

    // 的・本数・エンド数はスコアが記録済みの距離では編集できないため
    // （DistanceEditFieldsのhasShots制約）、まずdistanceBに記録してUndo
    // 履歴を残し、次にdistanceA自身は記録してからUndoしてスコアの無い
    // 状態でRedo履歴だけを残す。この状態でdistanceAの的を変更すると、
    // distanceA分のRedo履歴だけが破棄され、distanceB分のUndo履歴は
    // 影響を受けない。
    await user.click(screen.getByTestId("shot-cell-2-1-1"));
    await user.click(screen.getByTestId("score-button-9"));

    await user.click(screen.getByTestId("shot-cell-1-1-1"));
    await user.click(screen.getByTestId("score-button-10"));
    await user.click(screen.getByTestId("score-button-undo"));
    expect(screen.getByTestId("score-button-undo")).not.toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).not.toBeDisabled();

    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("target-face-picker-trigger"));
    await user.click(screen.getByTestId("target-face-format-tab-all"));
    await user.click(screen.getByTestId("target-face-bow-type-tab-all"));
    await user.click(
      screen.getByTestId(`target-face-option-${targetFaceNoX.id}`),
    );
    await user.click(screen.getByTestId("distance-config-save-1"));

    expect(screen.getByTestId("score-button-undo")).not.toBeDisabled();
    expect(screen.getByTestId("score-button-redo")).toBeDisabled();
  });

  it("的を変更せず距離を保存しても、Undo/Redo履歴は維持される", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("score-button-10"));

    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("distance-config-save-1"));

    expect(screen.getByTestId("score-button-undo")).not.toBeDisabled();
  });

  it("スコアが記録されていない距離を削除すると一覧から取り除かれる", async () => {
    const user = userEvent.setup();
    setup({ distances: [distanceA, distanceB] });

    await user.click(screen.getByTestId("distance-config-toggle-2"));
    await user.click(screen.getByTestId("distance-config-delete-2"));

    expect(screen.queryByTestId("distance-summary-2")).not.toBeInTheDocument();
  });

  it("距離編集パネルをEscapeで閉じると、保存せずパネルが閉じる", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("distance-config-toggle-1"));
    expect(
      screen.getByTestId("distance-config-distance-1"),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByTestId("distance-config-distance-1"),
    ).not.toBeInTheDocument();
    // 送信キューに積まれると送信が完了するまで同期中の表示になるため、同期済みのままであることで積まれていないことを確かめる。
    expect(screen.getByTestId("sync-status")).toHaveTextContent("同期済み");
    await flushMicrotasks();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("スコア記録済みの距離を確認の上で削除すると、そのショット・Undo履歴・選択状態も併せて破棄される", async () => {
    const user = userEvent.setup();
    setup({ distances: [distanceA, distanceB] });

    // distanceAの1マス目に記録（選択は自動的に2マス目へ進むが、
    // distanceA自体は選択中のまま）。
    await user.click(screen.getByTestId("score-button-10"));
    expect(screen.getByText("合計10")).toBeInTheDocument();

    await user.click(screen.getByTestId("distance-config-toggle-1"));
    await user.click(screen.getByTestId("distance-config-delete-1"));
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(screen.queryByTestId("distance-summary-2")).not.toBeInTheDocument();
    // distanceBがdistanceAの削除後、1番目の距離として表示される。
    expect(screen.getByTestId("distance-summary-1")).toBeInTheDocument();
    expect(screen.getByText("合計0")).toBeInTheDocument();
    expect(screen.getByTestId("score-button-undo")).toBeDisabled();
  });
});

describe("ScorecardClient プリセット保存", () => {
  it("保存すると save_round_as_preset が正しい内容で呼ばれ、ダイアログが閉じる", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("save-as-preset-trigger"));
    expect(screen.getByTestId("save-as-preset-name")).toHaveValue(
      "テストラウンド",
    );

    await user.click(screen.getByTestId("save-as-preset-confirm"));

    await waitFor(() => {
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
        ],
      });
    });
    expect(screen.queryByTestId("save-as-preset-name")).not.toBeInTheDocument();
  });

  it("未認証の場合はエラーを表示し、ダイアログは閉じない", async () => {
    supabase.getSession.mockResolvedValue({ data: { session: null } });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("save-as-preset-trigger"));
    await user.click(screen.getByTestId("save-as-preset-confirm"));

    expect(
      await screen.findByText("サインインが必要です。"),
    ).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("プリセット名が50文字を超える場合、送信せずエラーを表示する", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("save-as-preset-trigger"));
    await user.clear(screen.getByTestId("save-as-preset-name"));
    await user.type(screen.getByTestId("save-as-preset-name"), "あ".repeat(51));
    await user.click(screen.getByTestId("save-as-preset-confirm"));

    expect(
      screen.getByText("プリセット名は50文字以内で入力してください。"),
    ).toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("save_round_as_presetが失敗した場合はエラーを表示する", async () => {
    supabase.rpc.mockResolvedValue({
      error: { message: "保存に失敗しました。" },
    });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("save-as-preset-trigger"));
    await user.click(screen.getByTestId("save-as-preset-confirm"));

    expect(await screen.findByText("保存に失敗しました。")).toBeInTheDocument();
  });

  it("送信中はEscapeで閉じない", async () => {
    let resolveRpc: (value: { error: null }) => void = () => {};
    supabase.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("save-as-preset-trigger"));
    await user.click(screen.getByTestId("save-as-preset-confirm"));
    await user.keyboard("{Escape}");

    expect(screen.getByTestId("save-as-preset-name")).toBeInTheDocument();

    resolveRpc({ error: null });
    await waitFor(() => {
      expect(
        screen.queryByTestId("save-as-preset-name"),
      ).not.toBeInTheDocument();
    });
  });

  it("送信中に確定ボタンを連打しても二重送信しない", async () => {
    let resolveRpc: (value: { error: null }) => void = () => {};
    supabase.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("save-as-preset-trigger"));
    await user.click(screen.getByTestId("save-as-preset-confirm"));
    await user.click(screen.getByTestId("save-as-preset-confirm"));

    resolveRpc({ error: null });
    await waitFor(() => {
      expect(
        screen.queryByTestId("save-as-preset-name"),
      ).not.toBeInTheDocument();
    });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("Escapeで閉じて再度開くと、直前のエラーはクリアされる", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByTestId("save-as-preset-trigger"));
    await user.clear(screen.getByTestId("save-as-preset-name"));
    await user.type(screen.getByTestId("save-as-preset-name"), "あ".repeat(51));
    await user.click(screen.getByTestId("save-as-preset-confirm"));
    expect(
      screen.getByText("プリセット名は50文字以内で入力してください。"),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("save-as-preset-trigger"));

    expect(
      screen.queryByText("プリセット名は50文字以内で入力してください。"),
    ).not.toBeInTheDocument();
  });
});

describe("ScorecardClient ラウンド削除", () => {
  async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId("round-menu-trigger"));
    await user.click(await screen.findByTestId("round-delete"));
  }

  it("確認すると disable_round を実行し、一覧へ遷移する", async () => {
    const user = userEvent.setup();
    setup();

    await openDeleteConfirm(user);
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("disable_round", {
        p_round_event_id: expect.any(String),
        p_round_id: "round-1",
      });
    });
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith("/rounds");
    });
  });

  it("未認証の場合はエラーを表示し、遷移しない", async () => {
    supabase.getSession.mockResolvedValue({ data: { session: null } });
    const user = userEvent.setup();
    setup();

    await openDeleteConfirm(user);
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(
      await screen.findByText("サインインが必要です。"),
    ).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("通信エラー(例外)の場合は汎用エラーを表示する", async () => {
    supabase.getSession.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    setup();

    await openDeleteConfirm(user);
    await user.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(
      await screen.findByText(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      ),
    ).toBeInTheDocument();
  });

  it("セッション確認中にアンマウントされた場合、disable_roundを呼ばない", async () => {
    let resolveSession: (value: {
      data: { session: { user: { id: string } } | null };
    }) => void = () => {};
    supabase.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    const user = userEvent.setup();
    const { unmount } = setup();

    await openDeleteConfirm(user);
    await user.click(screen.getByTestId("confirm-dialog-confirm"));
    unmount();

    resolveSession({ data: { session: { user: { id: "user-1" } } } });
    await flushMicrotasks();

    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("ScorecardClient 保留中の操作の反映", () => {
  it("保留中の距離作成・スコア記録操作が反映される", async () => {
    await seedPendingOperations([
      {
        type: "distance.created",
        eventId: "e-distance",
        id: "distance-new",
        roundId: "round-1",
        positionKey: "aa",
        distance: 30,
        totalEnds: 1,
        arrowsPerEnd: 1,
        targetFaceId: targetFaceX.id,
        isMarked: true,
      },
      {
        type: "shot.recorded",
        eventId: "e-shot",
        distanceId: distanceA.id,
        endNumber: 1,
        arrowNumber: 1,
        scoreStr: "10",
        scoreInt: 10,
      },
    ]);
    // 既存のショット（別マス）を持たせることで、shot.recorded適用時の
    // 重複排除フィルタ（同じマスの既存ショットの除去）が実際に既存要素を
    // 走査する経路も検証する。
    setup({
      initialShots: [
        {
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 2,
          score_str: "9",
          score_int: 9,
        },
      ],
    });

    expect(await screen.findByTestId("distance-summary-2")).toBeInTheDocument();
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("10");
    expect(screen.getByTestId("shot-cell-1-1-2")).toHaveTextContent("9");
  });

  it("ラウンド設定更新・距離更新・ショットクリアの各操作が反映される", async () => {
    await seedPendingOperations([
      {
        type: "round.updated",
        eventId: "e-round",
        roundId: "round-1",
        name: "更新後ラウンド",
        roundDate: "2026-09-20",
        format: "outdoor",
        bowType: "compound",
      },
      {
        type: "distance.updated",
        eventId: "e-distance",
        distanceId: distanceA.id,
        distance: 50,
        totalEnds: distanceA.total_ends,
        arrowsPerEnd: distanceA.arrows_per_end,
        targetFaceId: distanceA.target_face_id,
        isMarked: distanceA.is_marked,
      },
      {
        type: "shot.cleared",
        eventId: "e-clear",
        distanceId: distanceA.id,
        endNumber: 1,
        arrowNumber: 1,
      },
    ]);
    setup({
      initialShots: [
        {
          distance_id: distanceA.id,
          end_number: 1,
          arrow_number: 1,
          score_str: "10",
          score_int: 10,
        },
      ],
    });

    expect(await screen.findByText(/更新後ラウンド/)).toBeInTheDocument();
    expect(screen.getByText(/50m/)).toBeInTheDocument();
    expect(screen.getByTestId("shot-cell-1-1-1")).toHaveTextContent("");
  });

  it("保留中の距離無効化操作が反映される", async () => {
    await seedPendingOperations([
      {
        type: "distance.disabled",
        eventId: "e-distance-disabled",
        distanceId: distanceB.id,
      },
    ]);
    setup({
      distances: [distanceA, distanceB],
      initialShots: [
        {
          distance_id: distanceB.id,
          end_number: 1,
          arrow_number: 1,
          score_str: "9",
          score_int: 9,
        },
      ],
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("distance-summary-2"),
      ).not.toBeInTheDocument();
    });
    // distanceBのショットも併せて破棄されるため、合計から除かれる。
    expect(screen.getByText("合計0")).toBeInTheDocument();
  });

  it("round.disabledの保留操作以降は処理を中断し、一覧へ遷移する", async () => {
    await seedPendingOperations([
      {
        type: "round.disabled",
        eventId: "e-round-disabled",
        roundId: "round-1",
      },
      {
        type: "distance.disabled",
        eventId: "e-distance-disabled",
        distanceId: distanceA.id,
      },
    ]);
    setup();

    await waitFor(() => {
      expect(nav.replace).toHaveBeenCalledWith("/rounds");
    });
    expect(screen.getByTestId("distance-summary-1")).toBeInTheDocument();
  });
});

describe("ScorecardClient 同期状態の表示", () => {
  it("送信中は「同期中…」を表示し、応答が返ると「同期済み」になる", async () => {
    // Given: RPCの応答を任意の時点で返せる
    let resolveRpc: (value: { data: null; error: null }) => void = () => {};
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
    resolveRpc({ data: null, error: null });

    // Then: 同期済みになる
    await waitFor(() => {
      expect(screen.getByTestId("sync-status")).toHaveTextContent("同期済み");
    });
  });

  it("送信が一時的に失敗してリトライを待つ間は「同期中…」を表示する", async () => {
    // Given: RPCが初回だけ再試行で解消し得るエラーを返す
    // fake-indexeddbはsetImmediateで処理を進めるため、リトライ待機のタイマーだけを偽装する。
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
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

  it("送信が恒久的に失敗した場合、同期失敗を表示しクリックでエラー内容を開ける", async () => {
    // Given: RPCが業務ルール違反（再試行しても解消しないエラー）を返す
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "保存に失敗しました", code: "P0001" },
    });
    const user = userEvent.setup();
    setup();

    // When: スコアを入力する
    await user.click(screen.getByTestId("score-button-10"));

    // Then: 同期失敗を表示し、サーバーの状態を取り直す
    await waitFor(() => {
      expect(screen.getByTestId("sync-status")).toHaveTextContent("同期失敗");
    });
    expect(nav.refresh).toHaveBeenCalledTimes(1);

    // When: 同期状態の表示をクリックする
    await user.click(screen.getByTestId("sync-status"));

    // Then: 失敗した操作とエラー内容を表示する
    expect(screen.getByText(/保存に失敗しました/)).toBeInTheDocument();
    expect(screen.getByText(/距離1 1エンド1本目/)).toBeInTheDocument();
  });
});

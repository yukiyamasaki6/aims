import { beforeEach, describe, expect, it, vi } from "vitest";
import { startRound } from "./start-round";

// SupabaseのSDKは外部サービスとの境界のため、セッション・プリセットの取得結果とRPCの結果を任意に制御できるスタブで模す。
// ラウンドの作成は、実物のSupabaseクライアントラッパーを通してこのスタブに届く。
const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: { getSession: supabase.getSession },
    rpc: supabase.rpc,
    from: supabase.from,
  }),
}));

const signedInSession = { data: { session: { user: { id: "user-1" } } } };

const PRESET_COLUMNS =
  "format, bow_type, preset_distances(id, position_key, distance, is_marked, total_ends, arrows_per_end, target_face_id)";

// 呼び出し順に"id-1", "id-2", ...を返すIDの生成。
function createIdGenerator() {
  let count = 0;
  return () => {
    count += 1;
    return `id-${count}`;
  };
}

// UTCでは2026-09-29になる日時。
const now = () => new Date("2026-09-29T12:00:00.000Z");

function startWith(
  presetId: string | null,
  isMounted: () => boolean = () => true,
) {
  return startRound({
    presetId,
    isMounted,
    generateId: createIdGenerator(),
    now,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getSession.mockResolvedValue(signedInSession);
  supabase.rpc.mockResolvedValue({ data: "round-1", error: null });
  supabase.from.mockReturnValue({ select: supabase.select });
  supabase.select.mockReturnValue({ eq: supabase.eq });
  supabase.eq.mockReturnValue({ maybeSingle: supabase.maybeSingle });
  supabase.maybeSingle.mockResolvedValue({
    data: {
      format: "indoor",
      bow_type: "compound",
      preset_distances: [
        {
          id: "d3",
          position_key: "c",
          distance: 30,
          is_marked: false,
          total_ends: 6,
          arrows_per_end: 6,
          target_face_id: "face-3",
        },
        {
          id: "d1",
          position_key: "a",
          distance: 18,
          is_marked: true,
          total_ends: 10,
          arrows_per_end: 3,
          target_face_id: "face-1",
        },
        {
          id: "d2",
          position_key: "b",
          distance: null,
          is_marked: true,
          total_ends: 12,
          arrows_per_end: 3,
          target_face_id: "face-2",
        },
      ],
    },
    error: null,
  });
});

describe("startRound", () => {
  describe("マウント中に完了した場合", () => {
    it("プリセット未選択では、プリセットを取得せず屋外・リカーブの距離無しでラウンドを作成する", async () => {
      // Given: サインイン済みで、create_roundが成功する
      // When: プリセット未選択でラウンドを作成する
      const result = await startWith(null);

      // Then: プリセットを取得せず、既定値の引数でcreate_roundを呼び、作成したラウンドのIDを返す
      expect(result).toEqual({ status: "created", roundId: "round-1" });
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(supabase.rpc).toHaveBeenCalledWith("create_round", {
        p_round_event_id: "id-2",
        p_id: "id-1",
        p_name: "",
        p_round_date: "2026-09-29",
        p_format: "outdoor",
        p_bow_type: "recurve",
        p_distances: [],
      });
    });

    it("プリセット選択時は、プリセットを取得し距離をposition_key順に並べて新しいIDでラウンドを作成する", async () => {
      // Given: サインイン済みで、選択中のプリセットの距離がposition_key順に並んでいない
      // When: プリセットを選択してラウンドを作成する
      const result = await startWith("preset-1");

      // Then: 選択中のプリセットを取得し、その種別・弓種と並べ替えた距離でcreate_roundを呼ぶ
      expect(result).toEqual({ status: "created", roundId: "round-1" });
      expect(supabase.from).toHaveBeenCalledWith("preset_rounds");
      expect(supabase.select).toHaveBeenCalledWith(PRESET_COLUMNS);
      expect(supabase.eq).toHaveBeenCalledWith("id", "preset-1");
      expect(supabase.rpc).toHaveBeenCalledWith("create_round", {
        p_round_event_id: "id-8",
        p_id: "id-7",
        p_name: "",
        p_round_date: "2026-09-29",
        p_format: "indoor",
        p_bow_type: "compound",
        p_distances: [
          {
            distance_event_id: "id-1",
            id: "id-2",
            position_key: "a",
            distance: 18,
            is_marked: true,
            total_ends: 10,
            arrows_per_end: 3,
            target_face_id: "face-1",
          },
          {
            distance_event_id: "id-3",
            id: "id-4",
            position_key: "b",
            distance: null,
            is_marked: true,
            total_ends: 12,
            arrows_per_end: 3,
            target_face_id: "face-2",
          },
          {
            distance_event_id: "id-5",
            id: "id-6",
            position_key: "c",
            distance: 30,
            is_marked: false,
            total_ends: 6,
            arrows_per_end: 6,
            target_face_id: "face-3",
          },
        ],
      });
    });

    it("サインインしていない場合、プリセットの取得もcreate_roundも行わずサインインを求めるエラーを返す", async () => {
      // Given: セッションがない
      supabase.getSession.mockResolvedValue({ data: { session: null } });

      // When: プリセットを選択してラウンドを作成する
      const result = await startWith("preset-1");

      // Then: プリセットの取得もcreate_roundも行わず、サインインを求めるエラーを返す
      expect(result).toEqual({
        status: "failed",
        error: "サインインが必要です。",
      });
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("プリセットの取得がエラーを返した場合、create_roundを呼ばず取得の失敗を返す", async () => {
      // Given: プリセットの取得がエラーを返す
      supabase.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: "permission denied" },
      });

      // When: プリセットを選択してラウンドを作成する
      const result = await startWith("preset-1");

      // Then: create_roundを呼ばず、取得の失敗を返す
      expect(result).toEqual({
        status: "failed",
        error: "プリセットの取得に失敗しました。",
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("プリセットが見つからない場合、create_roundを呼ばず取得の失敗を返す", async () => {
      // Given: プリセットの取得がエラー無しで空を返す
      supabase.maybeSingle.mockResolvedValue({ data: null, error: null });

      // When: プリセットを選択してラウンドを作成する
      const result = await startWith("preset-1");

      // Then: create_roundを呼ばず、取得の失敗を返す
      expect(result).toEqual({
        status: "failed",
        error: "プリセットの取得に失敗しました。",
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("create_roundがエラーを返した場合、そのメッセージをエラーとして返す", async () => {
      // Given: create_roundがエラーを返す
      supabase.rpc.mockResolvedValue({
        data: null,
        error: { message: "権限がありません。" },
      });

      // When: プリセット未選択でラウンドを作成する
      const result = await startWith(null);

      // Then: create_roundのエラーメッセージを返す
      expect(result).toEqual({ status: "failed", error: "権限がありません。" });
    });

    it("create_roundがエラー無しでラウンドのIDも返さない場合、作成の失敗を返す", async () => {
      // Given: create_roundがエラーもラウンドのIDも返さない
      supabase.rpc.mockResolvedValue({ data: null, error: null });

      // When: プリセット未選択でラウンドを作成する
      const result = await startWith(null);

      // Then: 作成の失敗を返す
      expect(result).toEqual({
        status: "failed",
        error: "ラウンドの作成に失敗しました。",
      });
    });

    it("通信中に例外が発生した場合、create_roundを呼ばず通信エラーを返す", async () => {
      // Given: セッションの取得で例外が発生する
      supabase.getSession.mockRejectedValue(new Error("network down"));

      // When: プリセット未選択でラウンドを作成する
      const result = await startWith(null);

      // Then: create_roundを呼ばず、通信エラーを返す
      expect(result).toEqual({
        status: "failed",
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe("完了を待つ間にアンマウントされた場合", () => {
    it("セッションの確認中にアンマウントされると、プリセットの取得もcreate_roundも行わず結果を破棄する", async () => {
      // Given: サインイン済みだが、セッションの確認中にアンマウントされる
      let mounted = true;
      supabase.getSession.mockImplementation(async () => {
        mounted = false;
        return signedInSession;
      });

      // When: プリセットを選択してラウンドを作成する
      const result = await startWith("preset-1", () => mounted);

      // Then: プリセットの取得もcreate_roundも行わず、結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("プリセットの取得中にアンマウントされると、create_roundを呼ばず結果を破棄する", async () => {
      // Given: プリセットの取得がエラーを返すが、その完了を待つ間にアンマウントされる
      let mounted = true;
      supabase.maybeSingle.mockImplementation(async () => {
        mounted = false;
        return { data: null, error: { message: "permission denied" } };
      });

      // When: プリセットを選択してラウンドを作成する
      const result = await startWith("preset-1", () => mounted);

      // Then: create_roundを呼ばず、結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("create_roundの完了を待つ間にアンマウントされると、作成できても結果を破棄する", async () => {
      // Given: create_roundは成功するが、その完了を待つ間にアンマウントされる
      let mounted = true;
      supabase.rpc.mockImplementation(async () => {
        mounted = false;
        return { data: "round-1", error: null };
      });

      // When: プリセット未選択でラウンドを作成する
      const result = await startWith(null, () => mounted);

      // Then: create_roundは呼んだうえで、結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it("例外の発生までにアンマウントされると、通信エラーを返さず結果を破棄する", async () => {
      // Given: セッションの確認中にアンマウントされ、そのまま例外が発生する
      let mounted = true;
      supabase.getSession.mockImplementation(async () => {
        mounted = false;
        throw new Error("network down");
      });

      // When: プリセット未選択でラウンドを作成する
      const result = await startWith(null, () => mounted);

      // Then: 結果を破棄したことを返す
      expect(result).toEqual({ status: "discarded" });
    });
  });
});
